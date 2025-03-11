import React, { useState, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import './pages/Viewer.css';

interface Message {
  id: string;
  role: string;
  content: string;
  parent?: string;
  children: string[];
}

interface ConversationNode {
  id: string;
  message?: {
    content?: {
      parts?: string[];
      content_type?: string;
    };
    author?: {
      role?: string;
    };
    create_time?: number;
  };
  parent?: string;
  children: string[];
}

interface ConversationData {
  mapping: Record<string, ConversationNode>;
}

const Viewer: React.FC = () => {
  const [messages, setMessages] = useState<Record<string, Message>>({});
  const [currentPath, setCurrentPath] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsLoading(true);
    setError(null);

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        const data = JSON.parse(content) as ConversationData;
        
        // 处理对话数据
        const processedMessages = processConversationData(data);
        setMessages(processedMessages.messages);
        setCurrentPath(processedMessages.initialPath);
      } catch (err) {
        console.error('Error parsing file:', err);
        setError('无法解析文件。请确保上传的是有效的对话树JSON文件。');
      } finally {
        setIsLoading(false);
      }
    };

    reader.onerror = () => {
      setError('读取文件时出错。');
      setIsLoading(false);
    };

    reader.readAsText(file);
  };

  const processConversationData = (data: ConversationData) => {
    if (!data || !data.mapping) {
      throw new Error('无效的对话数据格式');
    }

    const mapping = data.mapping;
    const processedMessages: Record<string, Message> = {};
    let rootId: string | undefined;

    // 首先找到根节点
    rootId = Object.keys(mapping).find(id => !mapping[id].parent);
    if (!rootId) throw new Error('找不到根节点');

    // 找到第一个非空的有效节点
    let startId = rootId;
    let skippedCount = 0;
    while (startId && 
           skippedCount < 2 && 
           mapping[startId].message?.author?.role === 'assistant' && 
           !mapping[startId].message?.content?.parts?.[0]) {
      startId = mapping[startId].children[0];
      skippedCount++;
    }

    // 处理所有节点，从第一个有效节点开始
    const processNode = (id: string) => {
      const node = mapping[id];
      processedMessages[id] = {
        id,
        role: node.message?.author?.role || 'unknown',
        content: node.message?.content?.parts?.[0] || '',
        parent: node.parent,
        children: node.children
      };
      // 递归处理子节点
      node.children.forEach(childId => {
        if (mapping[childId]) {
          processNode(childId);
        }
      });
    };

    if (startId) {
      processNode(startId);
    }

    // 构建初始路径
    const initialPath: string[] = [];
    let currentId = startId;
    while (currentId) {
      initialPath.push(currentId);
      const node = processedMessages[currentId];
      currentId = node.children[0];
    }

    return { messages: processedMessages, initialPath };
  };

  const handleSwitchBranch = (messageId: string, newChildId: string) => {
    const messageIndex = currentPath.indexOf(messageId);
    if (messageIndex === -1) return;

    // 更新路径
    const newPath = [...currentPath.slice(0, messageIndex + 1)];
    let currentId = newChildId;
    while (currentId) {
      newPath.push(currentId);
      const node = messages[currentId];
      currentId = node.children[0]; // 默认选择第一个子节点
    }
    setCurrentPath(newPath);

    // 滚动到底部
    setTimeout(() => {
      chatContainerRef.current?.scrollTo({
        top: chatContainerRef.current.scrollHeight,
        behavior: 'smooth'
      });
    }, 100);
  };

  const triggerFileInput = () => {
    fileInputRef.current?.click();
  };

  const getMessagePreview = (messageId: string) => {
    const message = messages[messageId];
    const content = message.content;
    const maxLength = 50;
    return content.length > maxLength ? content.slice(0, maxLength) + '...' : content;
  };

  return (
    <div className="viewer-container">
      <div className="header">
        <h1>ChatTree 查看器</h1>
        <div>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileUpload}
            accept=".json"
            className="hidden"
          />
          <button onClick={triggerFileInput} className="import-btn">
            导入对话树
          </button>
        </div>
      </div>

      {isLoading && (
        <div className="loading">
          <div className="spinner"></div>
          <p>正在加载...</p>
        </div>
      )}

      {error && (
        <div className="error">
          <p>{error}</p>
        </div>
      )}

      {!Object.keys(messages).length && !isLoading && !error && (
        <div className="empty-state">
          <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="17 8 12 3 7 8"></polyline>
            <line x1="12" y1="3" x2="12" y2="15"></line>
          </svg>
          <p>请导入对话树JSON文件</p>
          <button onClick={triggerFileInput}>选择文件</button>
        </div>
      )}

      {Object.keys(messages).length > 0 && (
        <div className="chat-container" ref={chatContainerRef}>
          {currentPath.map((messageId, index) => {
            const message = messages[messageId];
            
            // 特别处理：跳过根节点和系统消息
            if (index < 2 && (message.role === 'system' || message.role === 'unknown') && !message.content.trim()) {
              return null;
            }
            
            const isUser = message.role === 'user';
            const parent = message.parent;
            const hasSiblings = parent && messages[parent]?.children.length > 1;
            
            return (
              <div key={messageId} className="message-group">
                <div className={`message ${message.role}`}>
                  <div className="message-header">
                    <div className="role-indicator">
                      {isUser ? '用户输入' : 'AI 回复'}
                    </div>
                    {hasSiblings && (
                      <div className="branch-buttons">
                        {messages[parent].children.map((siblingId, siblingIndex) => {
                          const isSelected = currentPath.includes(siblingId);
                          const preview = getMessagePreview(siblingId);
                          const siblingRole = messages[siblingId].role;
                          return (
                            <button
                              key={siblingId}
                              className={`branch-button ${isSelected ? 'selected' : ''} ${siblingRole}`}
                              onClick={() => handleSwitchBranch(parent, siblingId)}
                              title={preview}
                            >
                              {siblingRole === 'user' ? `输入 ${siblingIndex + 1}` : `回复 ${siblingIndex + 1}`}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  <div className="message-content">
                    <ReactMarkdown>
                      {message.content.trim()}
                    </ReactMarkdown>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default Viewer;