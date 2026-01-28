"""
Demo Data Loader - Singleton for loading and querying preprocessed demo video assets
Loads from demo-assets-processed.json for demo video queries
"""

import json
import os
from pathlib import Path
from typing import Dict, List, Optional
from collections import defaultdict


class DemoDataLoader:
    """Singleton loader for demo asset data from JSON"""
    
    _instance = None
    _data = None
    
    # Demo video IDs
    DEMO_VIDEOS = {
        "2025_0817_115147_F",
        "2025_0817_115647_F", 
        "2025_0817_120147_F",
    }
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance
    
    def __init__(self):
        if self._data is None:
            self._load_data()
    
    def _load_data(self):
        """Load preprocessed demo data from JSON file"""
        data_path = Path(__file__).parent.parent / "demo-data" / "demo-assets-processed.json"
        
        if not data_path.exists():
            print(f"[DemoDataLoader] Demo data not found at {data_path}")
            self._data = {"videos": {}, "assets": [], "summary": {}}
            return
            
        with open(data_path, "r") as f:
            self._data = json.load(f)
        
        print(f"[DemoDataLoader] Loaded {len(self._data.get('assets', []))} demo assets")
    
    @classmethod
    def is_demo_video(cls, video_id: str) -> bool:
        """Check if a video ID is a demo video"""
        if not video_id:
            return False
        # Normalize: remove .mp4 extension if present
        normalized = video_id.replace(".mp4", "").replace(".MP4", "")
        return normalized in cls.DEMO_VIDEOS
    
    @property
    def videos(self) -> Dict:
        return self._data.get("videos", {})
    
    @property  
    def assets(self) -> List[Dict]:
        return self._data.get("assets", [])
    
    @property
    def summary(self) -> Dict:
        return self._data.get("summary", {})
    
    def get_assets_by_video(self, video_id: str) -> List[Dict]:
        """Get all assets for a specific video"""
        video_id = video_id.replace(".mp4", "").replace(".MP4", "")
        return [a for a in self.assets if a.get("video_id") == video_id]
    
    def get_summary_for_video(self, video_id: str) -> Dict:
        """Get summary statistics for a specific video"""
        video_id = video_id.replace(".mp4", "").replace(".MP4", "")
        assets = self.get_assets_by_video(video_id)
        
        by_category = defaultdict(int)
        by_type = defaultdict(int)
        by_condition = defaultdict(int)
        
        for a in assets:
            by_category[a.get("category", "Unknown")] += 1
            by_type[a.get("type", "Unknown")] += 1
            by_condition[a.get("condition", "Unknown")] += 1
        
        return {
            "video_id": video_id,
            "total_assets": len(assets),
            "by_category": dict(by_category),
            "by_type": dict(by_type),
            "by_condition": dict(by_condition),
        }
    
    def get_assets_by_type(self, asset_type: str, video_id: str = None) -> List[Dict]:
        """Get assets matching a type (smart match - matches normalized type names)"""
        # Normalize search term
        search_term = asset_type.lower().replace("_", " ").replace("-", " ").strip()
        search_words = set(search_term.split())
        
        results = []
        assets = self.get_assets_by_video(video_id) if video_id else self.assets
        
        for a in assets:
            asset_type_val = a.get("type", "").lower().replace("_", " ").replace("-", " ")
            class_name_val = a.get("className", "").lower().replace("_", " ").replace("-", " ")
            
            # Exact match after normalization
            if search_term == asset_type_val or search_term == class_name_val:
                results.append(a)
                continue
            
            # Check if all search words are present in the type
            type_words = set(asset_type_val.split())
            if search_words.issubset(type_words):
                results.append(a)
                continue
            
            # Check class name similarly
            class_words = set(class_name_val.split())
            if search_words.issubset(class_words):
                results.append(a)
        
        return results
    
    def get_assets_by_condition(self, condition: str, video_id: str = None) -> List[Dict]:
        """Get assets by condition"""
        condition_lower = condition.lower()
        assets = self.get_assets_by_video(video_id) if video_id else self.assets
        
        return [a for a in assets if condition_lower in a.get("condition", "").lower()]
    
    def get_assets_by_category(self, category: str, video_id: str = None) -> List[Dict]:
        """Get assets by category"""
        category_lower = category.lower()
        assets = self.get_assets_by_video(video_id) if video_id else self.assets
        
        return [a for a in assets if category_lower in a.get("category", "").lower()]
    
    def get_defects_by_category(self, video_id: str = None) -> Dict[str, int]:
        """Get count of damaged/defect assets per category"""
        assets = self.get_assets_by_video(video_id) if video_id else self.assets
        
        defects_by_category = defaultdict(int)
        bad_conditions = ["damaged", "bad", "poor", "missing", "broken", "bent"]
        
        for a in assets:
            condition = a.get("condition", "").lower()
            if condition in bad_conditions:
                category = a.get("category", "Unknown")
                defects_by_category[category] += 1
        
        return dict(defects_by_category)
    
    def get_condition_breakdown_for_type(self, asset_type: str, video_id: str = None) -> Dict:
        """Get good vs damaged count for a specific asset type"""
        assets = self.get_assets_by_type(asset_type, video_id)
        
        good_conditions = ["good", "fine", "visible"]
        bad_conditions = ["damaged", "bad", "poor", "missing", "broken", "bent", "dirty", "overgrown"]
        
        good_count = 0
        damaged_count = 0
        
        for a in assets:
            condition = a.get("condition", "").lower()
            if condition in good_conditions:
                good_count += 1
            elif condition in bad_conditions:
                damaged_count += 1
            else:
                good_count += 1  # Default to good
        
        total = len(assets)
        return {
            "asset_type": asset_type,
            "total": total,
            "good": good_count,
            "damaged": damaged_count,
            "damage_rate": round(damaged_count / total * 100, 1) if total else 0,
        }
    
    def get_damaged_assets_grouped(self, video_id: str = None) -> List[Dict]:
        """Get damaged assets grouped by type for improvements"""
        assets = self.get_assets_by_video(video_id) if video_id else self.assets
        
        bad_conditions = ["damaged", "bad", "poor", "missing", "broken", "bent", "dirty", "overgrown"]
        damaged_by_type = defaultdict(int)
        
        for a in assets:
            condition = a.get("condition", "").lower()
            if condition in bad_conditions:
                asset_type = a.get("type", "Unknown")
                damaged_by_type[asset_type] += 1
        
        # Return sorted by count descending
        return [
            {"type": t, "count": c} 
            for t, c in sorted(damaged_by_type.items(), key=lambda x: -x[1])
        ]


# Singleton instance getter
_demo_loader = None

def get_demo_loader() -> DemoDataLoader:
    """Get singleton demo data loader instance"""
    global _demo_loader
    if _demo_loader is None:
        _demo_loader = DemoDataLoader()
    return _demo_loader
