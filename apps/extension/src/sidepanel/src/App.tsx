import { useCallback, useEffect, useState } from 'react';
import './App.css';

interface ElementData {
  className: string;
  tailwindClasses: string[];
  tagName: string;
  id: string;
  elementPath?: string;
  styles: Record<string, string>;
}

// Extract parts from conditional expression for display
function extractConditionalParts(expression: string): string[] {
  const parts: string[] = [];
  // Match the pattern and extract parts
  const match = expression.match(/^(.+?)\s*\?\s*['"](.*?)['"]\s*:\s*['"](.*?)['"]$/);
  if (match) {
    parts.push(match[1].trim()); // condition
    parts.push('?');
    parts.push(`'${match[2]}'`); // true value
    parts.push(match[2]); // classes from true value
    parts.push(':');
    parts.push(`''`); // false value
  } else {
    // Not a conditional, split by spaces for regular classes
    parts.push(...expression.split(' ').filter(c => c.trim()));
  }
  return parts;
}

function App() {
  const [elementData, setElementData] = useState<ElementData | null>(null);
  const [editedClassName, setEditedClassName] = useState('');
  const [sourceClassNameExpression, setSourceClassNameExpression] = useState<string>('');
  const [isSelected, setIsSelected] = useState(false);
  const [hoveredData, setHoveredData] = useState<ElementData | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [devServerUrl, setDevServerUrl] = useState<string>('');
  const [isConnected, setIsConnected] = useState(false);
  const [elementPath, setElementPath] = useState<string>(''); // Store element's path in DOM for identification
  const [elementIndex, setElementIndex] = useState<number | undefined>(undefined);

  // Fetch source className expression from dev server
  const fetchSourceClassNameExpression = useCallback(async (tagName: string, index?: number) => {
    if (!devServerUrl) {
      // If not connected, use the rendered className
      return;
    }

    try {
      const response = await fetch(`${devServerUrl}/api/get-classname-expression`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tagName,
          elementIndex: index,
        }),
      });

      if (response.ok) {
        const result = await response.json();
        if (result.success && result.classNameExpression) {
          setSourceClassNameExpression(result.classNameExpression);
          setEditedClassName(result.classNameExpression);
        }
      }
    } catch (error) {
      console.error('Failed to fetch source className expression:', error);
      // Fall back to rendered className
    }
  }, [devServerUrl]);

  useEffect(() => {
    // Listen for hover and selection events from content script
    const messageHandler = (message: { type: string; data?: ElementData }) => {
      if (message.type === 'ELEMENT_HOVERED') {
        // Only update hover data if no element is selected
        if (!isSelected && message.data) {
          setHoveredData(message.data);
        }
      } else if (message.type === 'ELEMENT_SELECTED') {
        if (message.data) {
          setElementData(message.data);
          setEditedClassName(message.data.className);
          setIsSelected(true);
          setHoveredData(null);
          // Store element path if provided
          const msg = message as { type: string; data?: ElementData; elementPath?: string; elementIndex?: number };
          if (msg.elementPath) {
            setElementPath(msg.elementPath);
          } else if (message.data?.elementPath) {
            setElementPath(message.data.elementPath);
          }
          if (msg.elementIndex !== undefined) {
            setElementIndex(msg.elementIndex);
          }
          // Fetch source className expression from dev server
          fetchSourceClassNameExpression(message.data.tagName, msg.elementIndex);
        }
      } else if (message.type === 'ELEMENT_DESELECTED') {
        setIsSelected(false);
        setElementData(null);
        setEditedClassName('');
        setSourceClassNameExpression('');
        setElementIndex(undefined);
      }
    };

    chrome.runtime.onMessage.addListener(messageHandler);

    return () => {
      chrome.runtime.onMessage.removeListener(messageHandler);
    };
  }, [isSelected, fetchSourceClassNameExpression]);

  const handleSave = async () => {
    if (elementData) {
      // Update DOM immediately for instant preview
      chrome.runtime.sendMessage({
        type: 'UPDATE_STYLES',
        data: {
          className: editedClassName
        }
      });

      // Persist to source code if dev server is connected
      if (isConnected && devServerUrl) {
        const fetchUrl = `${devServerUrl}/api/update-classes`;
        const requestBody = {
          elementPath: elementPath,
          tagName: elementData.tagName,
          id: elementData.id,
          oldClassName: elementData.className,
          newClassName: editedClassName,
          tailwindClasses: elementData.tailwindClasses,
          elementIndex: elementIndex,
        };
        try {
          const response = await fetch(fetchUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody),
          });

          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Failed to persist changes: ${response.status} ${errorText}`);
          }

          const result = await response.json();
          console.log('Changes persisted:', result);
        } catch (error) {
          console.error('Failed to persist to source code:', error);
          alert('Failed to save to source code. Make sure the dev server is running and connected.');
        }
      }
    }
  };

  const handleConnect = async () => {
    if (!devServerUrl) {
      alert('Please enter a dev server URL');
      return;
    }

    try {
      // Test connection
      const response = await fetch(`${devServerUrl}/api/health`, {
        method: 'GET',
      });

      if (response.ok) {
        setIsConnected(true);
        // Save to chrome storage
        chrome.storage.local.set({ devServerUrl });
      } else {
        throw new Error('Server not responding');
      }
    } catch (error) {
      console.error('Connection failed:', error);
      alert('Failed to connect to dev server. Make sure it\'s running and the URL is correct.');
    }
  };

  // Load saved dev server URL on mount
  useEffect(() => {
    chrome.storage.local.get(['devServerUrl'], (result) => {
      if (result.devServerUrl) {
        setDevServerUrl(result.devServerUrl);
        // Test connection
        fetch(`${result.devServerUrl}/api/health`)
          .then(res => {
            if (res.ok) {
              setIsConnected(true);
            }
          })
          .catch(() => { });
      }
    });
  }, []);

  // Show editing UI when element is selected
  if (isSelected && elementData) {
    return (
      <div className="p-4">
        <div className="mb-4 pb-3 border-b border-gray-200">
          <div className="flex justify-between items-center mb-1">
            <h1 className="text-xl font-bold m-0">Seam</h1>
            <button
              onClick={() => {
                const newMode = !selectionMode;
                setSelectionMode(newMode);
                chrome.runtime.sendMessage({
                  type: 'TOGGLE_SELECTION_MODE',
                  enabled: newMode
                });
              }}
              className={`px-2 py-1 text-white rounded border-none text-[10px] font-medium cursor-pointer ${selectionMode ? 'bg-blue-600' : 'bg-gray-500'}`}
              title="Toggle selection mode"
            >
              {selectionMode ? 'ON' : 'OFF'}
            </button>
          </div>
          <p className="text-xs text-gray-500 m-0">Editing: <span className="font-semibold">{elementData.tagName}</span></p>
        </div>

        <div className="mb-4">
          <label className="block text-sm font-medium mb-2">
            Tailwind Classes:
          </label>
          <textarea
            value={editedClassName}
            onChange={(e) => setEditedClassName(e.target.value)}
            className="w-full p-2 border border-gray-300 rounded font-mono text-xs min-h-[80px] resize-y"
            placeholder="Enter Tailwind classes (e.g., bg-blue-500 text-white p-4)"
          />
        </div>

        {(sourceClassNameExpression || elementData.tailwindClasses.length > 0) && (
          <div className="mb-4">
            <p className="text-sm font-medium mb-2">Current Classes:</p>
            <div className="flex flex-wrap gap-1">
              {sourceClassNameExpression ? (
                // Display parsed conditional expression parts
                extractConditionalParts(sourceClassNameExpression).map((part, i) => (
                  <span
                    key={i}
                    className={`px-2 py-1 rounded text-[11px] font-mono ${part === '?' || part === ':' ? 'bg-gray-100 text-gray-500 font-bold' : 'bg-blue-100 text-blue-800 font-normal'}`}
                  >
                    {part}
                  </span>
                ))
              ) : (
                // Fallback to regular class display
                elementData.tailwindClasses.map((cls, i) => (
                  <span
                    key={i}
                    className="px-2 py-1 bg-blue-100 text-blue-800 rounded text-[11px] font-mono"
                  >
                    {cls}
                  </span>
                ))
              )}
            </div>
          </div>
        )}

        <div className="flex gap-2">
          <button
            onClick={handleSave}
            className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-2.5 px-4 rounded-md border-none text-sm font-medium cursor-pointer"
          >
            Apply Changes
          </button>
          <button
            onClick={() => {
              chrome.runtime.sendMessage({ type: 'ELEMENT_DESELECTED' });
              setIsSelected(false);
              setElementData(null);
            }}
            className="py-2.5 px-4 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-md border-none text-sm font-medium cursor-pointer"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // Show preview when hovering (but not selected)
  if (hoveredData && !isSelected) {
    return (
      <div className="p-4">
        <h1 className="text-xl font-bold mb-2">Seam</h1>
        <p className="text-gray-600 mb-3">Hovering over: <span className="font-semibold">{hoveredData.tagName}</span></p>
        <p className="text-xs text-gray-400 mb-4">
          {selectionMode ? 'Click to select and edit' : 'Enable selection mode to edit'}
        </p>
        {hoveredData.tailwindClasses.length > 0 && (
          <div>
            <p className="text-xs font-medium mb-2">Classes:</p>
            <div className="flex flex-wrap gap-1">
              {hoveredData.tailwindClasses.map((cls, i) => (
                <span
                  key={i}
                  className="px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded text-[10px] font-mono"
                >
                  {cls}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  // Default state
  return (
    <div className="p-4">
      <h1 className="text-xl font-bold mb-2">Seam</h1>
      <p className="text-gray-600 mb-3">Hover over an element to preview</p>

      {/* Dev Server Connection */}
      <div className={`mb-4 p-3 rounded-md border ${isConnected ? 'bg-green-100 border-green-500' : 'bg-yellow-100 border-yellow-500'}`}>
        <div className="mb-2">
          <label className="block text-xs font-medium mb-1">
            Dev Server URL:
          </label>
          <div className="flex gap-1">
            <input
              type="text"
              value={devServerUrl}
              onChange={(e) => setDevServerUrl(e.target.value)}
              placeholder="http://localhost:5173"
              className="flex-1 py-1.5 px-2 border border-gray-300 rounded text-xs"
            />
            <button
              onClick={handleConnect}
              className={`py-1.5 px-3 text-white rounded border-none text-xs font-medium cursor-pointer ${isConnected ? 'bg-green-500' : 'bg-blue-500'}`}
            >
              {isConnected ? 'Connected' : 'Connect'}
            </button>
          </div>
        </div>
        <p className="text-[11px] text-gray-500 m-0">
          {isConnected
            ? '✓ Connected - Changes will be saved to source files'
            : 'Connect to your dev server to persist changes to source code'}
        </p>
      </div>

      {/* Selection Mode */}
      <div className={`p-3 rounded-md border-2 ${selectionMode ? 'bg-blue-100 border-blue-500' : 'bg-gray-100 border-gray-300'}`}>
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium">Selection Mode</span>
          <button
            onClick={() => {
              const newMode = !selectionMode;
              setSelectionMode(newMode);
              chrome.runtime.sendMessage({
                type: 'TOGGLE_SELECTION_MODE',
                enabled: newMode
              });
            }}
            className={`py-1.5 px-3 text-white rounded border-none text-xs font-medium cursor-pointer ${selectionMode ? 'bg-blue-600' : 'bg-gray-500'}`}
          >
            {selectionMode ? 'ON' : 'OFF'}
          </button>
        </div>
        <p className="text-xs text-gray-500 m-0">
          {selectionMode
            ? 'Click any element to select and edit'
            : 'Enable selection mode to click and edit elements'}
        </p>
      </div>
    </div>
  );
}

export default App;