// Helper function to inject content script if needed
async function injectContentScript(tabId: number): Promise<void> {
    try {
        // Try to send a ping message to check if content script is loaded
        try {
            await chrome.tabs.sendMessage(tabId, { type: 'PING' });
            return; // Content script already loaded
        } catch (error) {
            // Content script not loaded, inject it
            await chrome.scripting.executeScript({
                target: { tabId },
                files: ['content/index.js']
            });
        }
    } catch (error) {
        // Silently fail - some pages can't have scripts injected
        console.debug('Could not inject content script:', error);
    }
}

// Message router between content script and sidepanel
chrome.runtime.onMessage.addListener((message) => {
    // Handle messages that don't need responses (fire and forget)
    if (message.type === "HOVER_ELEMENT") {
        chrome.runtime.sendMessage({
            type: "ELEMENT_HOVERED",
            data: message.data,
        }).catch(() => {
            // Sidepanel might not be open
        });
        return false; // No response needed
    }

    if (message.type === "ELEMENT_SELECTED") {
        chrome.runtime.sendMessage({
            type: "ELEMENT_SELECTED",
            data: message.data,
            elementPath: (message as any).elementPath
        }).catch(() => {
            // Sidepanel might not be open
        });
        return false; // No response needed
    }

    if (message.type === "ELEMENT_DESELECTED") {
        chrome.runtime.sendMessage({
            type: "ELEMENT_DESELECTED",
        }).catch(() => {
            // Sidepanel might not be open
        });
        return false; // No response needed
    }

    if (message.type === "UPDATE_STYLES") {
        // Fire and forget - don't wait for response
        chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
            if (tabs[0]?.id) {
                try {
                    // Ensure content script is injected
                    await injectContentScript(tabs[0].id);
                    await chrome.tabs.sendMessage(tabs[0].id, {
                        type: "APPLY_STYLES",
                        data: message.data
                    });
                } catch (error) {
                    console.error('Failed to send UPDATE_STYLES:', error);
                }
            }
        });
        return false; // No response needed
    }

    if (message.type === "TOGGLE_SELECTION_MODE") {
        // Fire and forget - don't wait for response
        chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
            if (tabs[0]?.id) {
                try {
                    // Ensure content script is injected
                    await injectContentScript(tabs[0].id);
                    await chrome.tabs.sendMessage(tabs[0].id, {
                        type: "TOGGLE_SELECTION_MODE",
                        enabled: message.enabled
                    });
                } catch (error) {
                    console.error('Failed to send TOGGLE_SELECTION_MODE:', error);
                }
            }
        });
        return false; // No response needed
    }

    // Default: no response needed
    return false;
});

chrome.action.onClicked.addListener((tab) => {
    // Open sidepanel first, don't wait for content script injection
    chrome.sidePanel.open({ windowId: tab.windowId });

    // Inject content script in background (non-blocking)
    if (tab.id) {
        injectContentScript(tab.id).catch((error) => {
            console.error('Failed to inject content script on sidepanel open:', error);
        });
    }
});
