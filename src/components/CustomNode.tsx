import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useState, useEffect } from 'react';
import {
  Handle,
  Position,
} from '@xyflow/react';

import { nodeWidth, nodeHeight } from "../constants/constants"

export const CustomNode = ({ data }: { data: any }) => {   
    const [isExpanded, setIsExpanded] = useState(false);
    const [isFavorite, setIsFavorite] = useState(false);
    const [favoriteName, setFavoriteName] = useState('');
    const [isNaming, setIsNaming] = useState(false);
    const [conversationId, setConversationId] = useState<string | null>(null);
  
    // 获取当前对话 ID
    useEffect(() => {
      const getCurrentConversationId = async () => {
        try {
          const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
          const currentTab = tabs[0];
          
          if (!currentTab?.url) return null;
          
          const url = new URL(currentTab.url);
          const pathParts = url.pathname.split('/');
          
          let convId = '';
          if (url.pathname.includes('/c/')) {
            convId = pathParts[pathParts.indexOf('c') + 1];
          } else if (url.pathname.includes('/g/')) {
            convId = pathParts[pathParts.indexOf('g') + 1];
          }
          
          if (convId) {
            setConversationId(convId);
          }
        } catch (error) {
          console.error('Error getting conversation ID:', error);
        }
      };
      
      getCurrentConversationId();
    }, []);
  
    // 检查节点是否已收藏
    useEffect(() => {
      const checkFavoriteStatus = async () => {
        if (!conversationId || !data?.id) return;
        
        try {
          const result = await chrome.storage.local.get(['favorites']);
          const allFavorites = result.favorites || {};
          
          // 获取当前对话的收藏
          const conversationFavorites = allFavorites[conversationId] || {};
          
          if (conversationFavorites[data.id]) {
            setIsFavorite(true);
            setFavoriteName(conversationFavorites[data.id].name || '');
          } else {
            setIsFavorite(false);
            setFavoriteName('');
          }
        } catch (error) {
          console.error('Error checking favorite status:', error);
        }
      };
      
      checkFavoriteStatus();
    }, [data?.id, conversationId]);
    
    // 监听收藏删除事件
    useEffect(() => {
      const handleFavoriteRemoved = (event: Event) => {
        const customEvent = event as CustomEvent;
        const { nodeId, conversationId: eventConvId } = customEvent.detail;
        
        // 只有当事件涉及当前节点且对话ID匹配时才更新状态
        if (nodeId === data?.id && eventConvId === conversationId) {
          setIsFavorite(false);
          setFavoriteName('');
        }
      };
      
      // 添加事件监听器
      window.addEventListener('favoriteRemoved', handleFavoriteRemoved);
      
      // 清理函数
      return () => {
        window.removeEventListener('favoriteRemoved', handleFavoriteRemoved);
      };
    }, [data?.id, conversationId]);
  
    // 切换收藏状态
    const toggleFavorite = async (e: React.MouseEvent) => {
      e.stopPropagation();
      
      try {
        if (!data || !data.id || !conversationId) {
          console.error('节点数据不完整或对话ID未获取，无法切换收藏状态');
          return;
        }
        
        const result = await chrome.storage.local.get(['favorites']);
        const allFavorites = result.favorites || {};
        
        // 确保当前对话的收藏对象存在
        if (!allFavorites[conversationId]) {
          allFavorites[conversationId] = {};
        }
        
        if (isFavorite) {
          // 取消收藏
          delete allFavorites[conversationId][data.id];
          setIsFavorite(false);
          setFavoriteName('');
          
          // 发送自定义事件，通知 FavoritesList 组件更新
          const event = new CustomEvent('favoriteToggled', { 
            detail: { 
              nodeId: data.id, 
              conversationId,
              action: 'remove'
            } 
          });
          window.dispatchEvent(event);
        } else {
          // 添加收藏
          setIsNaming(true);
          return; // 不立即保存，等待用户输入名称
        }
        
        await chrome.storage.local.set({ favorites: allFavorites });
      } catch (error) {
        console.error('Error toggling favorite:', error);
      }
    };
    
    // 保存收藏名称
    const saveFavoriteName = async (e: React.FormEvent) => {
      e.preventDefault();
      e.stopPropagation();
      
      try {
        if (!data || !data.id || !conversationId) {
          console.error('节点数据不完整或对话ID未获取，无法收藏');
          setIsNaming(false);
          return;
        }
        
        const result = await chrome.storage.local.get(['favorites']);
        const allFavorites = result.favorites || {};
        
        // 确保当前对话的收藏对象存在
        if (!allFavorites[conversationId]) {
          allFavorites[conversationId] = {};
        }
        
        const conversationFavorites = allFavorites[conversationId];
        const favoriteCount = Object.keys(conversationFavorites).length;
        
        const favoriteNode = {
          id: data.id,
          name: favoriteName || `收藏 ${favoriteCount + 1}`,
          role: data.role || 'unknown',
          content: data.label || '',
          timestamp: new Date().toISOString()
        };
        
        conversationFavorites[data.id] = favoriteNode;
        
        await chrome.storage.local.set({ favorites: allFavorites });
        setIsFavorite(true);
        setIsNaming(false);
        
        // 发送自定义事件，通知 FavoritesList 组件更新
        const event = new CustomEvent('favoriteToggled', { 
          detail: { 
            nodeId: data.id, 
            conversationId,
            action: 'add',
            node: favoriteNode
          } 
        });
        window.dispatchEvent(event);
      } catch (error) {
        console.error('Error saving favorite name:', error);
        setIsNaming(false);
      }
    };
  
    // 如果节点被标记为visually_hidden，则不渲染
    if (data.visually_hidden) {
      return (
        <>
          <Handle type="target" position={Position.Top} className="w-2 h-2" style={{ opacity: 0 }} />
          <Handle type="source" position={Position.Bottom} className="w-2 h-2" style={{ opacity: 0 }} />
        </>
      );
    }
  
    return (
      <>
        <div 
          className={`px-4 py-2 shadow-lg rounded-lg border transition-all duration-300 
            ${data.role === 'user' ? 'bg-yellow-50 border-yellow-200' : 'bg-gray-50 border-gray-200'}
            ${data.hidden ? 'grayscale' : ''}
            ${isExpanded ? 'fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-50 w-[80vw] h-[80vh]' : ''}
          `} 
          style={{
            width: isExpanded ? undefined : nodeWidth,
            height: isExpanded ? undefined : nodeHeight,
            position: isExpanded ? 'fixed' : 'relative',
            opacity: data.hidden && !isExpanded ? 0.4 : 1,
            background: data.hidden && !isExpanded ? 'repeating-linear-gradient(45deg, transparent, transparent 10px, rgba(0,0,0,0.03) 10px, rgba(0,0,0,0.03) 20px)' : undefined
          }}
          onDoubleClick={() => setIsExpanded(!isExpanded)}
        >
          {!isExpanded && <Handle type="target" position={Position.Top} className="w-2 h-2" />}
          
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <div className={`w-2 h-2 rounded-full mr-2 ${
                data.role === 'user' ? 'bg-yellow-400' : 'bg-gray-400'
              }`} />
              <div className="text-xs font-semibold text-gray-500 uppercase flex items-center space-x-2">
                <span>{data.role}</span>
                {data.role === 'assistant' && data.model_slug && (
                  <span className="font-normal text-gray-400 italic lowercase">
                    {data.model_slug}
                  </span>
                )}
                {data.isDebugMode && (
                  <span className="font-mono text-gray-400">
                    [{data.id}]
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center">
              {data.contentType === 'multimodal_text' && (
                <div className="mr-2">
                  <svg xmlns="http://www.w3.org/2000/svg" x="0px" y="0px" width="20" height="20" viewBox="0 0 26 26">
                  <path d="M 20.265625 4.207031 C 20.023438 3.96875 19.773438 3.722656 19.527344 3.476563 C 19.277344 3.230469 19.035156 2.980469 18.792969 2.734375 C 17.082031 0.988281 16.0625 0 15 0 L 7 0 C 4.796875 0 3 1.796875 3 4 L 3 22 C 3 24.203125 4.796875 26 7 26 L 19 26 C 21.203125 26 23 24.203125 23 22 L 23 8 C 23 6.9375 22.011719 5.917969 20.265625 4.207031 Z M 21 22 C 21 23.105469 20.105469 24 19 24 L 7 24 C 5.894531 24 5 23.105469 5 22 L 5 4 C 5 2.894531 5.894531 2 7 2 L 14.289063 1.996094 C 15.011719 2.179688 15 3.066406 15 3.953125 L 15 7 C 15 7.550781 15.449219 8 16 8 L 19 8 C 19.996094 8 21 8.003906 21 9 Z"></path>
                  </svg>
                </div>
              )}
              
              {/* 收藏按钮 */}
              <button 
                className={`ml-2 p-1 rounded-full hover:bg-gray-200 transition-colors ${isFavorite ? 'text-yellow-500' : 'text-gray-400'}`}
                onClick={toggleFavorite}
                title={isFavorite ? "取消收藏" : "收藏此节点"}
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill={isFavorite ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.5">
                  <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                </svg>
              </button>
            </div>
          </div>
          
          {/* 命名输入框 */}
          {isNaming && (
            <div className="mt-2 mb-2" onClick={(e) => e.stopPropagation()}>
              <form onSubmit={saveFavoriteName}>
                <input
                  type="text"
                  className="w-full px-2 py-1 text-xs border rounded"
                  placeholder="输入收藏名称..."
                  value={favoriteName}
                  onChange={(e) => setFavoriteName(e.target.value)}
                  autoFocus
                />
                <div className="flex justify-end mt-1 space-x-1">
                  <button
                    type="button"
                    className="px-2 py-1 text-xs bg-gray-200 rounded hover:bg-gray-300"
                    onClick={(e) => {
                      e.stopPropagation();
                      setIsNaming(false);
                    }}
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    className="px-2 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600"
                  >
                    保存
                  </button>
                </div>
              </form>
            </div>
          )}
  
          <div className={`mt-2 text-sm text-gray-700 ${
            isExpanded  
              ? 'h-[calc(100%-100px)] overflow-y-auto nowheel' 
              : 'line-clamp-3'
            }`} 
            style={{ wordBreak: 'break-word' }}
          >
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{data.label}</ReactMarkdown>
          </div>
  
          {data.timestamp && (
            <div className="absolute bottom-2 left-4 text-xs text-gray-400">
              {new Date(parseFloat(data.timestamp) * 1000).toLocaleString()} 
            </div>
          )}
          
          {!isExpanded && <Handle type="source" position={Position.Bottom} className="w-2 h-2" />}
  
          {isExpanded && (
            <button 
              className="absolute top-4 right-4 p-2 hover:bg-gray-100 rounded-full"
              onClick={() => setIsExpanded(false)}
            >
              ✕
            </button>
          )}
        </div>
  
        {isExpanded && (
          <div 
            className="fixed inset-0 bg-black bg-opacity-50 -z-10"
            onClick={() => setIsExpanded(false)}
          />
        )}
      </>
    );
  };