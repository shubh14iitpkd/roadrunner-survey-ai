// MongoDB script to fix double /uploads/ paths
// Run with: mongosh roadrunner fix_paths.js

print("================================================================================");
print("FIXING DOUBLE /uploads/ PATHS");
print("================================================================================");

// Find all videos
const videos = db.videos.find({}).toArray();

if (videos.length === 0) {
    print("❌ No videos found in database!");
} else {
    print(`Found ${videos.length} videos in database\n`);

    let fixedCount = 0;

    videos.forEach(video => {
        const videoId = video._id;
        const title = video.title || 'Untitled';
        let updated = false;
        const updateFields = {};

        // Check and fix annotated_video_url
        const annotatedUrl = video.annotated_video_url;
        if (annotatedUrl && annotatedUrl.includes('/uploads/uploads/')) {
            const fixedUrl = annotatedUrl.replace('/uploads/uploads/', '/uploads/');
            updateFields.annotated_video_url = fixedUrl;
            print(`\n📹 ${title}`);
            print(`  ❌ Old: ${annotatedUrl}`);
            print(`  ✅ New: ${fixedUrl}`);
            updated = true;
        }

        // Check and fix frames_directory
        const framesDir = video.frames_directory;
        if (framesDir && framesDir.includes('/uploads/uploads/')) {
            const fixedDir = framesDir.replace('/uploads/uploads/', '/uploads/');
            updateFields.frames_directory = fixedDir;
            print(`  Frames dir: ${framesDir} -> ${fixedDir}`);
            updated = true;
        }

        // Check and fix frame_metadata_url
        const metadataUrl = video.frame_metadata_url;
        if (metadataUrl && metadataUrl.includes('/uploads/uploads/')) {
            const fixedMetadata = metadataUrl.replace('/uploads/uploads/', '/uploads/');
            updateFields.frame_metadata_url = fixedMetadata;
            print(`  Metadata: ${metadataUrl} -> ${fixedMetadata}`);
            updated = true;
        }

        // Update if any fixes were needed
        if (updated) {
            db.videos.updateOne(
                { _id: videoId },
                { $set: updateFields }
            );
            fixedCount++;
        }
    });

    print("\n================================================================================");
    if (fixedCount > 0) {
        print(`✅ Fixed ${fixedCount} video(s) with double /uploads/ paths`);
    } else {
        print("✅ No videos needed fixing - all paths are correct!");
    }
    print("================================================================================");
}
