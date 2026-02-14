import { useCallback, useEffect, useRef, useState } from 'react';
import './App.css';
import { updateFileContent } from './fileUpdater';
import type { GitHubChange, GitHubRepository } from './github';
import {
  authenticateWithOAuth,
  commitChanges,
  createBranch,
  createPullRequest,
  getAuthenticatedUser,
  getDefaultBranch,
  getFileContent,
  getUserRepositories,
  parseRepo,
  validateRepoAccess,
  type GitHubConfig,
} from './github';

interface ElementData {
  className: string;
  tailwindClasses: string[];
  tagName: string;
  id: string;
  elementPath?: string;
  styles: Record<string, string>;
}

interface ChangeItem extends GitHubChange {
  selected?: boolean;
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
  const hasUserEditedRef = useRef(false);
  const [sourceClassNameExpression, setSourceClassNameExpression] = useState<string>('');
  const [isSelected, setIsSelected] = useState(false);
  const [hoveredData, setHoveredData] = useState<ElementData | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [devServerUrl, setDevServerUrl] = useState<string>('');
  const [isConnected, setIsConnected] = useState(false);
  const [elementPath, setElementPath] = useState<string>(''); // Store element's path in DOM for identification
  const [elementIndex, setElementIndex] = useState<number | undefined>(undefined);

  // GitHub integration state
  const [githubRepo, setGithubRepo] = useState<string>('');
  const [githubToken, setGithubToken] = useState<string>('');
  const [isGithubConnected, setIsGithubConnected] = useState(false);
  const [githubChanges, setGithubChanges] = useState<ChangeItem[]>([]);
  const [showPRModal, setShowPRModal] = useState(false);
  const [prTitle, setPrTitle] = useState('');
  const [prDescription, setPrDescription] = useState('');
  const [isCreatingPR, setIsCreatingPR] = useState(false);
  const [isConnectingGithub, setIsConnectingGithub] = useState(false);
  const [showRepoSelection, setShowRepoSelection] = useState(false);
  const [showDevServerModal, setShowDevServerModal] = useState(false);
  const [githubRepositories, setGithubRepositories] = useState<GitHubRepository[]>([]);
  const [githubUsername, setGithubUsername] = useState<string>('');
  const [repoSearchQuery, setRepoSearchQuery] = useState<string>('');

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
          // Only overwrite if user hasn't edited - otherwise we'd replace applied
          // classes with the stale server value (e.g. "mr-2" instead of "m-4 w-88 border...")
          if (!hasUserEditedRef.current) {
            setSourceClassNameExpression(result.classNameExpression);
          }
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
          hasUserEditedRef.current = false;
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

      // Update displayed state so Current Classes reflects the applied changes
      const newTailwindClasses = editedClassName.trim().split(/\s+/).filter(Boolean);
      setElementData((prev) => prev ? { ...prev, className: editedClassName, tailwindClasses: newTailwindClasses } : null);
      setSourceClassNameExpression(editedClassName);
      hasUserEditedRef.current = true; // Prevent late fetch from overwriting

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

          // Track change for GitHub PR
          if (isGithubConnected && githubRepo) {
            const change: ChangeItem = {
              id: `${Date.now()}-${Math.random()}`,
              timestamp: Date.now(),
              filePath: result.file || 'src/App.tsx', // Default file path
              tagName: elementData.tagName,
              oldClassName: elementData.className,
              newClassName: editedClassName,
              elementPath: elementPath,
              elementIndex: elementIndex,
              selected: true,
            };
            setGithubChanges((prev) => [...prev, change]);
          }
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
        setShowDevServerModal(false);
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

  // GitHub connection handler using OAuth
  const handleGithubConnect = async () => {
    setIsConnectingGithub(true);

    try {
      // Step 1: Authenticate with GitHub using OAuth
      const { token } = await authenticateWithOAuth();

      // Step 2: Get user info and repositories
      const user = await getAuthenticatedUser(token);
      const repos = await getUserRepositories(token);

      // Step 3: Store token and show repo selection
      setGithubToken(token);
      setGithubUsername(user.login);
      setGithubRepositories(repos);
      setShowRepoSelection(true);
    } catch (error) {
      console.error('GitHub connection failed:', error);
      alert(`Failed to connect to GitHub: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsConnectingGithub(false);
    }
  };

  // Handle repository selection
  const handleRepoSelect = async (repo: GitHubRepository) => {
    try {
      const config: GitHubConfig = {
        owner: repo.owner.login,
        repo: repo.name,
        token: githubToken,
      };

      // Validate access
      const hasAccess = await validateRepoAccess(config);
      if (!hasAccess) {
        throw new Error('Failed to access repository. Please ensure you have access.');
      }

      // Save connection state
      setGithubRepo(repo.full_name);
      setIsGithubConnected(true);
      setShowRepoSelection(false);
      setRepoSearchQuery('');

      // Save to chrome storage
      chrome.storage.local.set({
        githubRepo: repo.full_name,
        githubToken: githubToken, // Note: In production, this should be encrypted
      });
    } catch (error) {
      console.error('Failed to select repository:', error);
      alert(`Failed to connect to repository: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  // PR creation handler
  const handleCreatePR = async () => {
    if (githubChanges.length === 0) {
      alert('No changes to create PR with');
      return;
    }

    const selectedChanges = githubChanges.filter((c) => c.selected);
    if (selectedChanges.length === 0) {
      alert('Please select at least one change to include in the PR');
      return;
    }

    if (!prTitle.trim()) {
      alert('Please enter a PR title');
      return;
    }

    const parsed = parseRepo(githubRepo);
    if (!parsed) {
      alert('Invalid repo format');
      return;
    }

    setIsCreatingPR(true);

    try {
      const config: GitHubConfig = {
        owner: parsed.owner,
        repo: parsed.repo,
        token: githubToken,
      };

      // Get default branch
      const baseBranch = await getDefaultBranch(config);
      const branchName = `seam-changes-${Date.now()}`;

      // Create branch
      await createBranch(config, baseBranch, branchName);

      // Group changes by file path - multiple changes to the same file must be applied
      // together and committed once, otherwise the 2nd commit fails (SHA mismatch).
      const changesByFile = new Map<string, typeof selectedChanges>();
      for (const change of selectedChanges) {
        const repoPath = (() => {
          const p = change.filePath.replace(/\\/g, '/');
          const appsIdx = p.indexOf('apps/');
          if (appsIdx !== -1) return p.slice(appsIdx);
          return p;
        })();
        const list = changesByFile.get(repoPath) ?? [];
        list.push(change);
        changesByFile.set(repoPath, list);
      }

      const fileChanges: Array<{
        path: string;
        content: string;
        message: string;
        sha?: string;
      }> = [];

      for (const [repoPath, fileChangesList] of changesByFile) {
        try {
          // Get current file content (fetch once per file)
          const { content: currentContent, sha } = await getFileContent(
            config,
            repoPath,
            branchName
          );

          // Apply all changes to this file in order
          let content = currentContent;
          const messages: string[] = [];
          for (const change of fileChangesList) {
            content = updateFileContent(
              content,
              change.tagName,
              change.newClassName,
              change.elementIndex
            );
            messages.push(`${change.tagName}: ${change.oldClassName} → ${change.newClassName}`);
          }

          fileChanges.push({
            path: repoPath,
            content,
            message: `Update ${fileChangesList.length} element(s): ${messages.join('; ')}`,
            sha,
          });
        } catch (error) {
          console.error(`Failed to process changes for ${repoPath}:`, error);
        }
      }

      if (fileChanges.length === 0) {
        throw new Error('No changes could be applied');
      }

      // Commit all changes
      await commitChanges(config, branchName, fileChanges);

      // Create PR
      const { url } = await createPullRequest(
        config,
        prTitle,
        prDescription || `Updated ${selectedChanges.length} element(s) with new Tailwind classes.\n\nChanges:\n${selectedChanges.map((c) => `- ${c.tagName}: ${c.oldClassName} → ${c.newClassName}`).join('\n')}`,
        branchName,
        baseBranch
      );

      // Open PR in new tab
      chrome.tabs.create({ url });

      // Clear selected changes
      setGithubChanges((prev) => prev.filter((c) => !selectedChanges.find((sc) => sc.id === c.id)));
      setShowPRModal(false);
      setPrTitle('');
      setPrDescription('');

      alert('Pull request created successfully!');
    } catch (error) {
      console.error('Failed to create PR:', error);
      alert(`Failed to create PR: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsCreatingPR(false);
    }
  };

  // Load saved dev server URL and GitHub config on mount
  useEffect(() => {
    chrome.storage.local.get(['devServerUrl', 'githubRepo', 'githubToken', 'githubChanges'], (result) => {
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

      if (result.githubRepo && result.githubToken) {
        setGithubRepo(result.githubRepo);
        setGithubToken(result.githubToken);
        // Validate connection
        const parsed = parseRepo(result.githubRepo);
        if (parsed) {
          validateRepoAccess({
            owner: parsed.owner,
            repo: parsed.repo,
            token: result.githubToken,
          })
            .then((hasAccess) => {
              if (hasAccess) {
                setIsGithubConnected(true);
              }
            })
            .catch(() => { });
        }
      }

      if (result.githubChanges) {
        setGithubChanges(result.githubChanges);
      }
    });
  }, []);

  // Persist changes to storage
  useEffect(() => {
    if (githubChanges.length > 0) {
      chrome.storage.local.set({ githubChanges });
    }
  }, [githubChanges]);

  // Show editing UI when element is selected
  if (isSelected && elementData) {
    return (
      <div className="p-4">
        <div className="mb-4 pb-3 border-b border-gray-200">
          <div className="flex justify-between items-center mb-1">
            <h1 className="text-xl font-bold m-0">Select Mode</h1>
            <button
              type="button"
              title="Toggle selection mode"
              onClick={() => {
                const newMode = !selectionMode;
                setSelectionMode(newMode);
                chrome.runtime.sendMessage({
                  type: 'TOGGLE_SELECTION_MODE',
                  enabled: newMode
                });
              }}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-black transition-colors duration-200 focus:outline-none ${selectionMode ? 'bg-black' : 'bg-white'}`}
              >
              <span
                className={`pointer-events-none absolute top-1/2 -translate-y-1/2 rounded-full transition-all duration-200 ease-in-out ${selectionMode ? 'left-[calc(100%-1.25rem)] h-5 w-5 bg-white' : 'left-px h-[1.2rem] w-[1.2rem] bg-black'}`}
              />
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
            onChange={(e) => {
              hasUserEditedRef.current = true;
              setEditedClassName(e.target.value);
            }}
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

        <div>
          <button
            onClick={handleSave}
            className="w-full bg-black hover:bg-gray-800 text-white py-2.5 px-4 rounded-md border-none text-sm font-medium cursor-pointer"
          >
            Apply Changes
          </button>
        </div>

        {/* PR Creation Modal - must be in this view too so it shows when element is selected */}
        {showPRModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-4 max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto relative">
              <button
                onClick={() => {
                  setShowPRModal(false);
                  setPrTitle('');
                  setPrDescription('');
                }}
                className="absolute top-2 right-2 w-7 h-7 flex items-center justify-center text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded cursor-pointer border-none bg-transparent text-xl leading-none"
                aria-label="Close"
              >
                ×
              </button>
              <h2 className="text-lg font-bold mb-4 pr-8">Create Pull Request</h2>
              <div className="mb-4 text-left">
                <label className="block text-sm font-medium mb-2">PR Title</label>
                <input
                  type="text"
                  value={prTitle}
                  onChange={(e) => setPrTitle(e.target.value)}
                  placeholder="Update Tailwind classes"
                  className="w-full p-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-black"
                />
              </div>
              <div className="mb-4 text-left">
                <label className="block text-sm font-medium mb-2">PR Description</label>
                <textarea
                  value={prDescription}
                  onChange={(e) => setPrDescription(e.target.value)}
                  placeholder="Describe your changes..."
                  className="w-full p-2 border border-gray-300 rounded text-sm min-h-[100px] focus:outline-none focus:border-black"
                />
              </div>
              <div className="mb-4 text-left">
                <label className="block text-sm font-medium mb-2">Select Changes</label>
                <div className="border border-gray-300 rounded p-2 max-h-[200px] overflow-y-auto">
                  {githubChanges.map((change) => (
                    <label key={change.id} className="flex items-start mb-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={change.selected || false}
                        onChange={(e) => {
                          setGithubChanges((prev) =>
                            prev.map((c) =>
                              c.id === change.id ? { ...c, selected: e.target.checked } : c
                            )
                          );
                        }}
                        className="mt-1 mr-2"
                      />
                      <div className="flex-1">
                        <div className="text-xs font-medium">{change.filePath}</div>
                        <div className="text-xs text-gray-600">
                          {change.tagName}: <span className="line-through">{change.oldClassName}</span>{' '}
                          → <span className="font-semibold">{change.newClassName}</span>
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
              <button
                onClick={handleCreatePR}
                disabled={isCreatingPR}
                className="w-full bg-black hover:bg-gray-800 disabled:bg-gray-400 text-white py-2 px-4 rounded-md border-none text-sm font-medium cursor-pointer"
              >
                {isCreatingPR ? 'Creating PR...' : 'Create Pull Request'}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Show preview when hovering (but not selected)
  if (hoveredData && !isSelected) {
    return (
      <div className="p-4">
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
      {/* Selection Mode - top, no background */}
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm font-medium">Selection Mode</span>
        <button
          type="button"
          title="Toggle selection mode"
          onClick={() => {
            const newMode = !selectionMode;
            setSelectionMode(newMode);
            chrome.runtime.sendMessage({
              type: 'TOGGLE_SELECTION_MODE',
              enabled: newMode
            });
          }}
          className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-black transition-colors duration-200 focus:outline-none ${selectionMode ? 'bg-black' : 'bg-white'}`}
        >
          <span
            className={`pointer-events-none absolute top-1/2 -translate-y-1/2 rounded-full transition-all duration-200 ease-in-out ${selectionMode ? 'left-[calc(100%-1.25rem)] h-5 w-5 bg-white' : 'left-px h-[1.2rem] w-[1.2rem] bg-black'}`}
          />
        </button>
      </div>

      {/* Dev Server Connection */}
      <div className="mb-4 text-center">
        {isConnected ? (
          <div className="text-xs text-green-600">
            ✓ Connected to dev server URL: {devServerUrl}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowDevServerModal(true)}
            className="text-xs underline cursor-pointer bg-transparent border-none p-0 hover:text-gray-600"
          >
            Connect to a dev server URL
          </button>
        )}
      </div>

      {/* Dev Server URL Modal */}
      {showDevServerModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-4 max-w-md w-full mx-4 relative">
            <button
              onClick={() => setShowDevServerModal(false)}
              className="absolute top-2 right-2 w-7 h-7 flex items-center justify-center text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded cursor-pointer border-none bg-transparent text-xl leading-none"
              aria-label="Close"
            >
              ×
            </button>
            <h2 className="text-lg font-bold mb-4 pr-8">Connect to dev server</h2>
            <div className="flex gap-2">
              <input
                type="text"
                value={devServerUrl}
                onChange={(e) => setDevServerUrl(e.target.value)}
                placeholder="http://localhost:5173"
                className="flex-1 py-2 px-3 border border-gray-300 rounded text-sm"
                autoFocus
              />
              <button
                onClick={handleConnect}
                className="py-2 px-4 bg-black hover:bg-gray-800 text-white rounded border-none text-sx cursor-pointer"
              >
                Connect
              </button>
            </div>
          </div>
        </div>
      )}

      {/* GitHub Connection */}
      {isGithubConnected ? (
        <div className="mb-4 text-center text-xs">
          <span className="text-green-600">✓ Connected to {githubRepo}</span>
          {' '}
          <button
            type="button"
            onClick={() => {
              setIsGithubConnected(false);
              setGithubRepo('');
              setGithubToken('');
              setGithubUsername('');
              chrome.storage.local.remove(['githubRepo', 'githubToken']);
            }}
            className="underline cursor-pointer bg-transparent border-none p-0 text-inherit hover:text-gray-600"
          >
             Disconnect
          </button>
        </div>
      ) : (
        <div className="mb-4">
          <button
            onClick={handleGithubConnect}
            disabled={isConnectingGithub}
            className={`w-full py-1.5 px-3 text-white rounded border-none text-xs font-medium cursor-pointer ${isConnectingGithub
              ? 'bg-gray-400 cursor-not-allowed'
              : 'bg-black hover:bg-black'
            }`}
          >
            {isConnectingGithub ? 'Connecting...' : 'Connect with GitHub'}
          </button>
        </div>
      )}

      {/* Repository Selection Modal */}
      {showRepoSelection && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-4 max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto relative">
            <button
              onClick={() => {
                setShowRepoSelection(false);
                setGithubToken('');
                setGithubRepositories([]);
                setRepoSearchQuery('');
              }}
              className="absolute top-2 right-2 w-7 h-7 flex items-center justify-center text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded cursor-pointer border-none bg-transparent text-xl leading-none"
              aria-label="Close"
            >
              ×
            </button>
            <h2 className="text-lg font-bold mb-4 pr-8">
              Select Repository {githubUsername && `(${githubUsername})`}
            </h2>

            {/* Search input */}
            <div className="mb-4">
              <input
                type="text"
                value={repoSearchQuery}
                onChange={(e) => setRepoSearchQuery(e.target.value)}
                placeholder="Search repositories..."
                className="w-full p-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-black"
                autoFocus
              />
            </div>

            {/* Repository list */}
            <div className="rounded max-h-[400px] overflow-y-auto">
              {githubRepositories
                .filter((repo) =>
                  repo.full_name.toLowerCase().includes(repoSearchQuery.toLowerCase()) ||
                  (repo.description && repo.description.toLowerCase().includes(repoSearchQuery.toLowerCase()))
                )
                .map((repo) => (
                  <button
                    key={repo.id}
                    onClick={() => handleRepoSelect(repo)}
                    className="w-full mb-2 text-left p-3 hover:bg-gray-100 border-b border-gray-200 last:border-b-0 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm">{repo.full_name}</span>
                          {repo.private && (
                            <span className="text-xs bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded">
                              Private
                            </span>
                          )}
                        </div>
                        {repo.description && (
                          <p className="text-xs text-gray-500 mt-1 line-clamp-2">{repo.description}</p>
                        )}
                      </div>
                      <svg
                        className="w-5 h-5 text-gray-400"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M9 5l7 7-7 7"
                        />
                      </svg>
                    </div>
                  </button>
                ))}
            </div>

            {githubRepositories.filter((repo) =>
              repo.full_name.toLowerCase().includes(repoSearchQuery.toLowerCase()) ||
              (repo.description && repo.description.toLowerCase().includes(repoSearchQuery.toLowerCase()))
            ).length === 0 && (
                <p className="text-sm text-gray-500 text-center py-4">No repositories found</p>
              )}
          </div>
        </div>
      )}

      {/* Create PR Button */}
      {isGithubConnected && githubChanges.length > 0 && (
        <div className="mb-4">
          <button
            onClick={() => setShowPRModal(true)}
            className="w-full py-2.5 px-4 bg-black hover:bg-gray-800 text-white rounded-md border-none text-sm font-medium cursor-pointer"
          >
            Create Pull Request ({githubChanges.length} change{githubChanges.length !== 1 ? 's' : ''})
          </button>
        </div>
      )}

      {/* PR Creation Modal */}
      {showPRModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-4 max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto relative">
            <button
              onClick={() => {
                setShowPRModal(false);
                setPrTitle('');
                setPrDescription('');
              }}
              className="absolute top-2 right-2 w-7 h-7 flex items-center justify-center text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded cursor-pointer border-none bg-transparent text-xl leading-none"
              aria-label="Close"
            >
              ×
            </button>
            <h2 className="text-lg font-bold mb-4 pr-8">Create Pull Request</h2>

            <div className="mb-4 text-left">
              <label className="block text-sm font-medium mb-2">PR Title</label>
              <input
                type="text"
                value={prTitle}
                onChange={(e) => setPrTitle(e.target.value)}
                placeholder="Update Tailwind classes"
                className="w-full p-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-black"
              />
            </div>

            <div className="mb-4 text-left">
              <label className="block text-sm font-medium mb-2">PR Description</label>
              <textarea
                value={prDescription}
                onChange={(e) => setPrDescription(e.target.value)}
                placeholder="Describe your changes..."
                className="w-full p-2 border border-gray-300 rounded text-sm min-h-[100px] focus:outline-none focus:border-black"
              />
            </div>

            <div className="mb-4 text-left">
              <label className="block text-sm font-medium mb-2">Select Changes</label>
              <div className="border border-gray-300 rounded p-2 max-h-[200px] overflow-y-auto">
                {githubChanges.map((change) => (
                  <label key={change.id} className="flex items-start mb-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={change.selected || false}
                      onChange={(e) => {
                        setGithubChanges((prev) =>
                          prev.map((c) =>
                            c.id === change.id ? { ...c, selected: e.target.checked } : c
                          )
                        );
                      }}
                      className="mt-1 mr-2"
                    />
                    <div className="flex-1">
                      <div className="text-xs font-medium">{change.filePath}</div>
                      <div className="text-xs text-gray-600">
                        {change.tagName}: <span className="line-through">{change.oldClassName}</span>{' '}
                        → <span className="font-semibold">{change.newClassName}</span>
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            <button
              onClick={handleCreatePR}
              disabled={isCreatingPR}
              className="w-full bg-black hover:bg-gray-800 disabled:bg-gray-400 text-white py-2 px-4 rounded-md border-none text-sm font-medium cursor-pointer"
            >
              {isCreatingPR ? 'Creating PR...' : 'Create Pull Request'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;