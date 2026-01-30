# Photo Upload to Copilot - Automation Guide

## Overview
Photos submitted through the quote widget need to be uploaded to the customer's Images tab in Copilot.

## Photo Locations
Photos are saved to: `/home/ubuntu/clawd/tools/estimate-widget/photos/{date}/{email}_{submissionId}/`

## Manual Upload Process
1. Navigate to: `https://secure.copilotcrm.com/customers/details/images/{customerId}`
2. Click "Add Images" button
3. Use FilePond uploader to select photos
4. Photos appear in customer's gallery

## Clawdbot Automation Workflow
When processing a quote request with photos:

1. **Get photo paths** from the notification:
   ```javascript
   notification.photoPaths // Array of local file paths
   ```

2. **Use browser automation** to upload:
   - Navigate to customer's Images tab
   - Click "Add Images" 
   - Upload each photo file
   - Verify upload success

3. **Browser tool commands** (for Clawd):
   ```
   browser action=navigate targetUrl="https://secure.copilotcrm.com/customers/details/images/{customerId}"
   browser action=act request={kind: "click", ref: "Add Images button"}
   browser action=upload paths=["/path/to/photo1.jpg", "/path/to/photo2.jpg"]
   ```

## Supported Formats
- JPEG, PNG, GIF (images) - max 50MB
- MP4, MOV (videos) - max 500MB (5 min recommended)
- PDF (documents)

## Notes
- Photos are evidence of what the customer submitted
- Useful for cleanup/trimming quotes where pricing depends on photos
- Map snapshots show what area the customer measured (dispute prevention)
