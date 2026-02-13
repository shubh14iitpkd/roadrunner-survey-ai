import os

DEMO_VIDEOS = {
    "2025_0817_115147_F",
    "2025_0817_115647_F",
    "2025_0817_120147_F",
}


def get_video_key(video_url):
    if not video_url:
        return None
    return os.path.splitext(os.path.basename(video_url))[0]

def is_demo(video_file=None, video_url=None):
    if not video_url:
        if not video_file:
            return False
        video_url = video_file.get("storage_url")

    basename = get_video_key(video_url)
    return basename in DEMO_VIDEOS
