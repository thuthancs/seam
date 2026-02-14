// Hover detection and DOM manipulation

let hoveredElement: HTMLElement | null = null;
let selectedElement: HTMLElement | null = null;
let highlightOverlay: HTMLElement | null = null;
let selectionModeEnabled = false;

function createHighlightOverlay() {
    const overlay = document.createElement('div');
    overlay.style.cssText = `
        position: absolute;
        border: 2px solid #3b82f6;
        background: rgba(59, 130, 246, 0.1);
        pointer-events: none;
        z-index: 999999;
        display: none;
    `;
    document.body.appendChild(overlay);
    return overlay;
}

function highlightElement(element: HTMLElement) {
    if (!highlightOverlay) {
        highlightOverlay = createHighlightOverlay();
    }

    const rect = element.getBoundingClientRect();
    highlightOverlay.style.display = 'block';
    highlightOverlay.style.left = `${rect.left + window.scrollX}px`;
    highlightOverlay.style.top = `${rect.top + window.scrollY}px`;
    highlightOverlay.style.width = `${rect.width}px`;
    highlightOverlay.style.height = `${rect.height}px`;
}

// Helper to get element path in DOM (for identification)
function getElementPath(element: HTMLElement): string {
    const path: string[] = [];
    let current: HTMLElement | null = element;

    while (current && current !== document.body) {
        // get the base (e.g., div, span, etc.)
        let selector = current.tagName.toLowerCase();

        if (current.id) {
            selector += `#${current.id}`;
            path.unshift(selector);
            break; // ID is unique, no need to go further
        }

        if (current.className && typeof current.className === 'string') {
            const classes = current.className.split(' ').filter(c => c.trim()).slice(0, 2).join('.');
            if (classes) {
                selector += `.${classes}`;
            }
        }

        // Add sibling index if needed
        const siblings = Array.from(current.parentElement?.children || []);
        const index = siblings.indexOf(current);
        if (siblings.length > 1 && index > 0) {
            selector += `:nth-child(${index + 1})`;
        }

        path.unshift(selector);
        current = current.parentElement;
    }

    return path.join(' > ');
}

// Helper to get element index (which occurrence of this tagName in the document)
function getElementIndex(element: HTMLElement): number {
    const tagName = element.tagName.toLowerCase();
    const allElements = Array.from(document.querySelectorAll(tagName));
    return allElements.indexOf(element);
}

function extractStyles(element: HTMLElement) {
    // Handle both string (HTML) and SVGAnimatedString (SVG) className
    const classNameValue = typeof element.className === 'string'
        ? element.className
        : String(element.className || '');
    const className = classNameValue || '';
    const computedStyle = window.getComputedStyle(element);

    // Extract Tailwind classes from className
    const tailwindClasses = className.split(' ').filter((cls: string) => cls.trim() && !cls.startsWith('_'));
    return {
        className: className,
        tailwindClasses: tailwindClasses,
        tagName: element.tagName.toLowerCase(),
        id: element.id || '',
        elementPath: getElementPath(element),
        styles: {
            color: computedStyle.color,
            backgroundColor: computedStyle.backgroundColor,
            fontSize: computedStyle.fontSize,
            padding: computedStyle.padding,
            margin: computedStyle.margin,
        }
    }
}

document.addEventListener('mouseover', (e) => {
    const target = e.target as HTMLElement;
    if (target === highlightOverlay) return;

    hoveredElement = target;

    // Only highlight if no element is selected, or if hovering over a different element
    if (!selectedElement || selectedElement !== target) {
        highlightElement(target);
    }

    const styleData = extractStyles(target);

    chrome.runtime.sendMessage({
        type: 'HOVER_ELEMENT',
        data: styleData
    }).catch((error) => {
        // Silently fail for hover messages - background might not be ready
    });
});

document.addEventListener('mouseout', () => {
    // Keep highlight if element is selected, otherwise hide it
    if (highlightOverlay && !selectedElement) {
        highlightOverlay.style.display = 'none';
    }
});

// Click to select an element (only when selection mode is enabled)
document.addEventListener('click', (e) => {
    if (!selectionModeEnabled) {
        return;
    }

    // Get the actual element (handle text nodes)
    let target = e.target as HTMLElement;
    if (!target || target.nodeType === Node.TEXT_NODE) {
        target = target?.parentElement as HTMLElement;
    }
    if (!target || target === highlightOverlay) return;

    const tagName = target.tagName.toLowerCase();

    // For links, allow navigation unless it's just for styling
    if (tagName === 'a' && target.getAttribute('href') && !target.getAttribute('href')?.startsWith('#')) {
        return; // Allow navigation for real links
    }

    // Prevent default to avoid navigation or other click behaviors
    // This allows selection of all elements including form elements
    e.preventDefault();
    e.stopPropagation();

    console.log('Selecting element:', target.tagName, target.className);

    // If clicking the same element, deselect it
    if (selectedElement === target) {
        selectedElement = null;
        if (highlightOverlay) {
            highlightOverlay.style.display = 'none';
        }
        chrome.runtime.sendMessage({
            type: 'ELEMENT_DESELECTED'
        });
    } else {
        // Select the new element
        selectedElement = target;
        highlightElement(target);

        const styleData = extractStyles(target);
        const elementIndex = getElementIndex(target);
        console.log('Sending selection data:', styleData, 'elementIndex:', elementIndex);
        chrome.runtime.sendMessage({
            type: 'ELEMENT_SELECTED',
            data: styleData,
            elementPath: styleData.elementPath,
            elementIndex: elementIndex
        }).catch((error) => {
            console.error('Failed to send ELEMENT_SELECTED:', error);
        });
    }
}, true); // Use capture phase to catch clicks early

// Listen for messages from sidepanel
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Handle ping to check if content script is loaded
    if (message.type === 'PING') {
        sendResponse({ status: 'ok' });
        return true;
    }

    if (message.type === 'APPLY_STYLES') {
        const targetElement = selectedElement || hoveredElement;
        if (targetElement) {
            const { className } = message.data;
            targetElement.className = className;
            // Do NOT send ELEMENT_SELECTED here - the sidepanel already updated its state in handleSave.
            // Sending ELEMENT_SELECTED would trigger fetchSourceClassNameExpression, which fetches the
            // OLD value from the server (source not updated yet) and overwrites the displayed classes.
        }
        return true;
    } else if (message.type === 'TOGGLE_SELECTION_MODE') {
        selectionModeEnabled = message.enabled;
        console.log('Selection mode toggled:', selectionModeEnabled);

        // If disabling selection mode, deselect any selected element
        if (!selectionModeEnabled && selectedElement) {
            selectedElement = null;
            if (highlightOverlay) {
                highlightOverlay.style.display = 'none';
            }
            chrome.runtime.sendMessage({
                type: 'ELEMENT_DESELECTED'
            });
        }
        return true;
    }
    return true;
});