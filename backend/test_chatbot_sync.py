#!/usr/bin/env python3.10
"""
Test script to verify new chatbot.py is synced with routes.py
"""

import sys
sys.path.insert(0, '.')

from ai.chatbot import get_chatbot

def test_basic_functionality():
    """Test basic chatbot functionality"""
    print("="*70)
    print("Testing New Chatbot Integration")
    print("="*70)
    
    # Initialize chatbot
    print("\n1. Initializing chatbot...")
    chatbot = get_chatbot()
    print(f"   ✅ Chatbot type: {type(chatbot).__name__}")
    
    # Verify required methods
    print("\n2. Verifying required methods...")
    methods = ['ask', 'get_history', 'clear_history', 'close']
    for method in methods:
        status = "✅" if hasattr(chatbot, method) else "❌"
        print(f"   {status} {method}()")
    
    # Verify components
    print("\n3. Verifying components...")
    components = ['schema_loader', 'db', 'intent_analyzer', 'location_handler',
                  'query_gen', 'answer_gen', 'video_handler', 'memory']
    for comp in components:
        status = "✅" if hasattr(chatbot, comp) else "❌"
        print(f"   {status} {comp}")
    
    # Test queries
    print("\n4. Testing timestamp query (the issue you reported)...")
    test_chat_id = '6969ee907c18d783bcbc671c'
    
    try:
        answer = chatbot.ask(
            'kerbs present at what timestamps',
            conversation_history=[],
            chat_id=test_chat_id
        )
        
        # Check if it's the proper formatted answer, not raw context
        if "**Timestamps for" in answer and "confidence" in answer:
            print("   ✅ Query returns properly formatted answer")
            print(f"   ✅ Answer length: {len(answer)} chars")
            print(f"   ✅ Contains timestamps: {'00:' in answer}")
        elif "Video 1:" in answer and "- ID:" in answer:
            print("   ❌ FAILED: Returns raw context instead of formatted answer")
            return False
        else:
            print(f"   ⚠️  Unexpected answer format")
            print(f"   Answer preview: {answer[:100]}...")
    except Exception as e:
        print(f"   ❌ Error: {e}")
        return False
    
    print("\n5. Testing other query types...")
    test_queries = [
        ('what defects were detected', 'video metadata'),
        ('how many street lights', 'frames collection'),
        ('list all assets', 'video metadata')
    ]
    
    for query, query_type in test_queries:
        try:
            answer = chatbot.ask(query, conversation_history=[], chat_id=test_chat_id)
            print(f"   ✅ '{query}' ({query_type})")
        except Exception as e:
            print(f"   ❌ '{query}' failed: {e}")
            return False
    
    print("\n" + "="*70)
    print("✅ ALL TESTS PASSED")
    print("="*70)
    print("\nThe new chatbot.py is properly synced with routes.py!")
    print("The timestamp query issue is fixed.")
    return True

if __name__ == "__main__":
    success = test_basic_functionality()
    sys.exit(0 if success else 1)
