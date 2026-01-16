# S3 CORS Configuration for Video Upload

## Problem
Browser cannot upload to S3 due to CORS policy blocking:
```
Access to XMLHttpRequest at 'https://datanh11.s3.amazonaws.com/' from origin 'http://localhost:8080' 
has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present
```

## Solution: Configure S3 CORS

### Option 1: AWS Console (Easiest)

1. Go to [AWS S3 Console](https://s3.console.aws.amazon.com/s3/buckets/datanh11)
2. Select bucket `datanh11`
3. Click **Permissions** tab
4. Scroll to **Cross-origin resource sharing (CORS)**
5. Click **Edit**
6. Paste this configuration:

```json
[
    {
        "AllowedHeaders": [
            "*"
        ],
        "AllowedMethods": [
            "PUT",
            "POST",
            "GET"
        ],
        "AllowedOrigins": [
            "http://localhost:8080",
            "http://localhost:5173",
            "https://roadsightai.roadvision.ai"
        ],
        "ExposeHeaders": [
            "ETag"
        ],
        "MaxAgeSeconds": 3000
    }
]
```

7. Click **Save changes**

### Option 2: AWS CLI

```bash
aws s3api put-bucket-cors --bucket datanh11 --cors-configuration file://cors-config.json
```

**cors-config.json:**
```json
{
    "CORSRules": [
        {
            "AllowedHeaders": ["*"],
            "AllowedMethods": ["PUT", "POST", "GET"],
            "AllowedOrigins": [
                "http://localhost:8080",
                "http://localhost:5173",
                "https://roadsightai.roadvision.ai"
            ],
            "ExposeHeaders": ["ETag"],
            "MaxAgeSeconds": 3000
        }
    ]
}
```

### Verify CORS is Set

```bash
aws s3api get-bucket-cors --bucket datanh11
```

## Test After Configuration

1. Restart your frontend dev server
2. Try uploading a video again
3. Check browser console - CORS error should be gone
4. You should see upload progress to S3

## Production Setup

For production, update `AllowedOrigins` to only include your production domain:
```json
"AllowedOrigins": ["https://roadsightai.roadvision.ai"]
```

## Alternative: Direct Backend Upload (No CORS needed)

If you don't want to configure CORS, the fallback to direct backend upload will work automatically. 
The app already falls back to this if S3 upload fails.
