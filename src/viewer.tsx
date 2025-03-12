import React, { useState, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import './pages/Viewer.css';

interface Message {
  id: string;
  role: string;
  content: string;
  parent?: string;
  children: string[];
  hidden?: boolean;
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
  const [isDebugMode, setIsDebugMode] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    console.log('开始处理文件:', file.name, '大小:', file.size, 'bytes');
    setIsLoading(true);
    setError(null);

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        console.log('文件内容长度:', content.length);
        
        // 尝试解析 JSON
        let data;
        try {
          data = JSON.parse(content) as ConversationData;
        } catch (parseError: any) {
          console.error('JSON 解析错误:', parseError);
          setError(`JSON 解析错误: ${parseError.message}`);
          setIsLoading(false);
          return;
        }
        
        console.log('数据解析成功, 标题:', (data as any).title || '无标题');
        console.log('对话节点数量:', Object.keys(data.mapping || {}).length);
        
        // 处理对话数据
        try {
          const processedMessages = processConversationData(data);
          console.log('处理后的消息数量:', Object.keys(processedMessages.messages).length);
          console.log('初始路径长度:', processedMessages.initialPath.length);
          
          setMessages(processedMessages.messages);
          setCurrentPath(processedMessages.initialPath);
        } catch (processError: any) {
          console.error('处理对话数据错误:', processError);
          setError(`处理对话数据错误: ${processError.message}`);
        }
      } catch (err) {
        console.error('处理文件错误:', err);
        setError('无法解析文件。请确保上传的是有效的对话树JSON文件。');
      } finally {
        setIsLoading(false);
      }
    };

    reader.onerror = () => {
      console.error('读取文件错误');
      setError('读取文件时出错。');
      setIsLoading(false);
    };

    reader.readAsText(file);
  };

  const processConversationData = (data: ConversationData) => {
    if (!data || !data.mapping) {
      console.error('无效的对话数据格式:', data);
      throw new Error('无效的对话数据格式');
    }

    const mapping = data.mapping;
    const processedMessages: Record<string, Message> = {};

    // 找到根节点后，直接使用根节点作为起始节点
    const rootId = Object.keys(mapping).find(id => !mapping[id].parent);
    if (!rootId) {
      console.error('找不到根节点, 所有节点:', Object.keys(mapping));
      throw new Error('找不到根节点');
    }
    
    console.log('找到根节点:', rootId);

    // 使用根节点作为起始节点，不再跳过空的 AI 回复节点
    let startId = rootId;

    console.log('开始处理节点, 起始节点:', startId);

    // 处理所有节点，从起始节点开始
    const processNode = (id: string) => {
      if (!mapping[id]) {
        console.warn('节点不存在:', id);
        return;
      }
      
      const node = mapping[id];
      
      // 判断是否需要隐藏该消息，但不跳过，以保持对话树结构
      let isHidden = false;
      if (node.message?.content?.content_type === 'model_editable_context' ||
          (node.message?.author?.role === 'assistant' && (!node.message?.content?.parts || !node.message?.content?.parts[0]?.trim())) ||
          ((node.message as any)?.metadata?.is_visually_hidden_from_conversation === true)) {
        console.log('隐藏空消息或特殊 content_type:', id);
        isHidden = true;
      }
      
      // 处理消息内容，支持文本和图片
      let content = '';
      if (node.message?.content?.parts) {
        content = node.message.content.parts
          .map(part => {
            if (typeof part === 'string') {
              return part;
            }
            console.log('发现非字符串内容:', typeof part);
            return '[图片]';
          })
          .join('\n\n');
      }
      
      // 如果需要隐藏，则强制置空内容
      if (isHidden) {
        content = '';
      }
      
      // 始终将节点添加到 processedMessages，以保持对话树结构
      processedMessages[id] = {
        id,
        role: node.message?.author?.role || 'unknown',
        content: content,
        hidden: isHidden,
        parent: node.parent,
        children: node.children
      };
      
      // 递归处理所有子节点
      node.children.forEach(childId => {
        if (mapping[childId]) {
          processNode(childId);
        } else {
          console.warn('子节点不存在:', childId);
        }
      });
    };

    if (startId) {
      processNode(startId);
    } else {
      console.error('没有有效的起始节点');
      throw new Error('没有有效的起始节点');
    }

    // 构建初始路径
    const initialPath: string[] = [];
    let currentId = startId;
    while (currentId) {
      initialPath.push(currentId);
      const node = processedMessages[currentId];
      if (!node) {
        console.warn('路径中的节点不存在:', currentId);
        break;
      }
      currentId = node.children[0];
    }

    console.log('初始路径构建完成, 长度:', initialPath.length);

    return { messages: processedMessages, initialPath };
  };

  const handleSwitchBranch = (messageId: string, newChildId: string) => {
    console.log('切换分支, 从:', messageId, '到子节点:', newChildId);
    const messageIndex = currentPath.indexOf(messageId);
    if (messageIndex === -1) {
      console.warn('消息不在当前路径中:', messageId);
      return;
    }

    // 更新路径
    const newPath = [...currentPath.slice(0, messageIndex + 1)];
    let currentId = newChildId;
    while (currentId) {
      newPath.push(currentId);
      const node = messages[currentId];
      if (!node) {
        console.warn('路径中的节点不存在:', currentId);
        break;
      }
      currentId = node.children[0]; // 默认选择第一个子节点
    }
    
    console.log('新路径构建完成, 长度:', newPath.length);
    setCurrentPath(newPath);
  };

  const triggerFileInput = () => {
    fileInputRef.current?.click();
  };

  const getMessagePreview = (messageId: string) => {
    const message = messages[messageId];
    if (!message) return '无内容';
    
    // 获取消息预览，最多显示 50 个字符
    const content = message.content.trim();
    if (!content) return '无内容';
    
    return content.length > 50 ? content.substring(0, 50) + '...' : content;
  };

  return (
    <div className="viewer-container">
      <div className="header">
        <div className="flex items-center space-x-4">
          <h1>ChatTree 查看器</h1>
          <label className="flex items-center space-x-2 cursor-pointer">
            <input
              type="checkbox"
              checked={isDebugMode}
              onChange={(e) => setIsDebugMode(e.target.checked)}
              className="form-checkbox h-4 w-4 text-blue-600"
            />
            <span className="text-sm text-gray-700">调试模式</span>
          </label>
        </div>
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
            if (message.hidden) return null;

            // 特别处理：跳过根节点和系统消息
            if (index < 2 && (message.role === 'system' || message.role === 'unknown') && !message.content.trim()) {
              return null;
            }
            
            const isUser = message.role === 'user';
            const parent = message.parent;
            const hasSiblings = parent && messages[parent]?.children.filter(childId => !messages[childId].hidden).length > 1;
            
            return (
              <div key={messageId} className="message-group">
                <div className={`message ${message.role}`}>
                  <div className="message-header">
                    <div className="role-indicator">
                      {isUser ? '用户输入' : 'AI 回复'}
                      {isDebugMode && (
                        <span className="debug-id ml-2 text-gray-400 font-mono text-xs">
                          [{messageId}]
                        </span>
                      )}
                    </div>
                    {hasSiblings && (
                      <div className="branch-buttons">
                        {messages[parent].children.filter(childId => !messages[childId].hidden).map((siblingId, siblingIndex) => {
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