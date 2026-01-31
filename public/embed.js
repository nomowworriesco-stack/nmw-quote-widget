/**
 * No Mow Worries Estimate Widget - Embed Script
 * 
 * Usage: Add this to your page where you want the widget:
 * <div id="nmw-widget"></div>
 * <script src="https://estimate-widget.vercel.app/embed.js"></script>
 * 
 * Or with options:
 * <script>
 *   window.NMW_WIDGET_OPTIONS = { containerId: 'my-custom-id' };
 * </script>
 * <script src="https://estimate-widget.vercel.app/embed.js"></script>
 */
(function() {
    'use strict';
    
    const options = window.NMW_WIDGET_OPTIONS || {};
    const containerId = options.containerId || 'nmw-widget';
    const widgetUrl = options.widgetUrl || 'https://estimate-widget.vercel.app/?embed=true';
    
    const container = document.getElementById(containerId);
    if (!container) {
        console.error('NMW Widget: Container #' + containerId + ' not found');
        return;
    }
    
    // Create iframe
    const iframe = document.createElement('iframe');
    iframe.src = widgetUrl;
    iframe.id = 'nmw-widget-iframe';
    iframe.style.cssText = 'width: 100%; border: none; display: block; overflow: hidden;';
    iframe.setAttribute('scrolling', 'no');
    iframe.setAttribute('frameborder', '0');
    
    // Set initial height (will be updated dynamically)
    iframe.style.height = '800px';
    
    container.appendChild(iframe);
    
    // Listen for height updates from the widget
    window.addEventListener('message', function(event) {
        // Verify origin for security
        if (!event.origin.includes('estimate-widget.vercel.app') && 
            !event.origin.includes('localhost')) {
            return;
        }
        
        if (event.data && event.data.type === 'nmw-widget-height') {
            const newHeight = event.data.height;
            if (newHeight && newHeight > 0) {
                iframe.style.height = newHeight + 'px';
            }
        }
    });
    
    // Also handle iframe load
    iframe.addEventListener('load', function() {
        // Request initial height after load
        try {
            iframe.contentWindow.postMessage({ type: 'nmw-request-height' }, '*');
        } catch(e) {}
    });
})();
