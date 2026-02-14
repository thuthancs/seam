import { useEffect, useState } from 'react';
import './App.css';

interface ElementData {
  className: string;
  tailwindClasses: string[];
  tagName: string;
  id: string;
  elementPath?: string;
  styles: Record<string, string>;
}

function App() {
  const [elementData, setElementData] = useState<ElementData | null>(null);
  const [editedClassName, setEditedClassName] = useState('');
  const [isSelected, setIsSelected] = useState(false);
  const [hoveredData, setHoveredData] = useState<ElementData | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [devServerUrl, setDevServerUrl] = useState<string>('');
  const [isConnected, setIsConnected] = useState(false);
  const [elementPath, setElementPath] = useState<string>(''); // Store element's path in DOM for identification

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
          const msg = message as { type: string; data?: ElementData; elementPath?: string };
          if (msg.elementPath) {
            setElementPath(msg.elementPath);
          } else if (message.data?.elementPath) {
            setElementPath(message.data.elementPath);
          }
        }
      } else if (message.type === 'ELEMENT_DESELECTED') {
        setIsSelected(false);
        setElementData(null);
        setEditedClassName('');
      }
    };

    chrome.runtime.onMessage.addListener(messageHandler);

    return () => {
      chrome.runtime.onMessage.removeListener(messageHandler);
    };
  }, [isSelected]);

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
      }
    });
  }, []);

  // Show editing UI when element is selected
  if (isSelected && elementData) {
    return (
      <div style={{ padding: '16px' }}>
        <div style={{ marginBottom: '16px', paddingBottom: '12px', borderBottom: '1px solid #e5e7eb' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
            <h1 style={{ fontSize: '20px', fontWeight: 'bold', margin: 0 }}>Seam</h1>
            <button
              onClick={() => {
                const newMode = !selectionMode;
                setSelectionMode(newMode);
                chrome.runtime.sendMessage({
                  type: 'TOGGLE_SELECTION_MODE',
                  enabled: newMode
                });
              }}
              style={{
                padding: '4px 8px',
                backgroundColor: selectionMode ? '#2563eb' : '#6b7280',
                color: 'white',
                borderRadius: '4px',
                border: 'none',
                fontSize: '10px',
                fontWeight: '500',
                cursor: 'pointer'
              }}
              title="Toggle selection mode"
            >
              {selectionMode ? 'ON' : 'OFF'}
            </button>
          </div>
          <p style={{ fontSize: '12px', color: '#6b7280', margin: 0 }}>Editing: <span style={{ fontWeight: '600' }}>{elementData.tagName}</span></p>
        </div>

        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', fontSize: '14px', fontWeight: '500', marginBottom: '8px' }}>
            Tailwind Classes:
          </label>
          <textarea
            value={editedClassName}
            onChange={(e) => setEditedClassName(e.target.value)}
            style={{
              width: '100%',
              padding: '8px',
              border: '1px solid #d1d5db',
              borderRadius: '4px',
              fontFamily: 'monospace',
              fontSize: '12px',
              minHeight: '80px',
              resize: 'vertical'
            }}
            placeholder="Enter Tailwind classes (e.g., bg-blue-500 text-white p-4)"
          />
        </div>

        {elementData.tailwindClasses.length > 0 && (
          <div style={{ marginBottom: '16px' }}>
            <p style={{ fontSize: '14px', fontWeight: '500', marginBottom: '8px' }}>Current Classes:</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
              {elementData.tailwindClasses.map((cls, i) => (
                <span
                  key={i}
                  style={{
                    padding: '4px 8px',
                    backgroundColor: '#dbeafe',
                    color: '#1e40af',
                    borderRadius: '4px',
                    fontSize: '11px',
                    fontFamily: 'monospace'
                  }}
                >
                  {cls}
                </span>
              ))}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={handleSave}
            style={{
              flex: 1,
              backgroundColor: '#2563eb',
              color: 'white',
              padding: '10px 16px',
              borderRadius: '6px',
              border: 'none',
              fontSize: '14px',
              fontWeight: '500',
              cursor: 'pointer'
            }}
            onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#1d4ed8'}
            onMouseOut={(e) => e.currentTarget.style.backgroundColor = '#2563eb'}
          >
            Apply Changes
          </button>
          <button
            onClick={() => {
              chrome.runtime.sendMessage({ type: 'ELEMENT_DESELECTED' });
              setIsSelected(false);
              setElementData(null);
            }}
            style={{
              padding: '10px 16px',
              backgroundColor: '#f3f4f6',
              color: '#374151',
              borderRadius: '6px',
              border: 'none',
              fontSize: '14px',
              fontWeight: '500',
              cursor: 'pointer'
            }}
            onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#e5e7eb'}
            onMouseOut={(e) => e.currentTarget.style.backgroundColor = '#f3f4f6'}
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
      <div style={{ padding: '16px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 'bold', marginBottom: '8px' }}>Seam</h1>
        <p style={{ color: '#666', marginBottom: '12px' }}>Hovering over: <span style={{ fontWeight: '600' }}>{hoveredData.tagName}</span></p>
        <p style={{ fontSize: '12px', color: '#9ca3af', marginBottom: '16px' }}>
          {selectionMode ? 'Click to select and edit' : 'Enable selection mode to edit'}
        </p>
        {hoveredData.tailwindClasses.length > 0 && (
          <div>
            <p style={{ fontSize: '12px', fontWeight: '500', marginBottom: '8px' }}>Classes:</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
              {hoveredData.tailwindClasses.map((cls, i) => (
                <span
                  key={i}
                  style={{
                    padding: '2px 6px',
                    backgroundColor: '#f3f4f6',
                    color: '#4b5563',
                    borderRadius: '4px',
                    fontSize: '10px',
                    fontFamily: 'monospace'
                  }}
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
    <div style={{ padding: '16px' }}>
      <h1 style={{ fontSize: '20px', fontWeight: 'bold', marginBottom: '8px' }}>Seam</h1>
      <p style={{ color: '#666', marginBottom: '12px' }}>Hover over an element to preview</p>

      {/* Dev Server Connection */}
      <div style={{
        marginBottom: '16px',
        padding: '12px',
        backgroundColor: isConnected ? '#d1fae5' : '#fef3c7',
        borderRadius: '6px',
        border: `1px solid ${isConnected ? '#10b981' : '#f59e0b'}`
      }}>
        <div style={{ marginBottom: '8px' }}>
          <label style={{ display: 'block', fontSize: '12px', fontWeight: '500', marginBottom: '4px' }}>
            Dev Server URL:
          </label>
          <div style={{ display: 'flex', gap: '4px' }}>
            <input
              type="text"
              value={devServerUrl}
              onChange={(e) => setDevServerUrl(e.target.value)}
              placeholder="http://localhost:5173"
              style={{
                flex: 1,
                padding: '6px 8px',
                border: '1px solid #d1d5db',
                borderRadius: '4px',
                fontSize: '12px'
              }}
            />
            <button
              onClick={handleConnect}
              style={{
                padding: '6px 12px',
                backgroundColor: isConnected ? '#10b981' : '#3b82f6',
                color: 'white',
                borderRadius: '4px',
                border: 'none',
                fontSize: '12px',
                fontWeight: '500',
                cursor: 'pointer'
              }}
            >
              {isConnected ? 'Connected' : 'Connect'}
            </button>
          </div>
        </div>
        <p style={{ fontSize: '11px', color: '#6b7280', margin: 0 }}>
          {isConnected
            ? '✓ Connected - Changes will be saved to source files'
            : 'Connect to your dev server to persist changes to source code'}
        </p>
      </div>

      {/* Selection Mode */}
      <div style={{
        padding: '12px',
        backgroundColor: selectionMode ? '#dbeafe' : '#f3f4f6',
        borderRadius: '6px',
        border: `2px solid ${selectionMode ? '#3b82f6' : '#d1d5db'}`
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
          <span style={{ fontSize: '14px', fontWeight: '500' }}>Selection Mode</span>
          <button
            onClick={() => {
              const newMode = !selectionMode;
              setSelectionMode(newMode);
              chrome.runtime.sendMessage({
                type: 'TOGGLE_SELECTION_MODE',
                enabled: newMode
              });
            }}
            style={{
              padding: '6px 12px',
              backgroundColor: selectionMode ? '#2563eb' : '#6b7280',
              color: 'white',
              borderRadius: '4px',
              border: 'none',
              fontSize: '12px',
              fontWeight: '500',
              cursor: 'pointer'
            }}
          >
            {selectionMode ? 'ON' : 'OFF'}
          </button>
        </div>
        <p style={{ fontSize: '12px', color: '#6b7280', margin: 0 }}>
          {selectionMode
            ? 'Click any element to select and edit'
            : 'Enable selection mode to click and edit elements'}
        </p>
      </div>
    </div>
  );
}

export default App;