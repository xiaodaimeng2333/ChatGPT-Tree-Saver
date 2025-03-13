import { useState, useEffect } from 'react';

interface FavoriteNode {
  id: string;
  name: string;
  role: string;
  content: string;
  timestamp: string;
}

interface FavoritesListProps {
  onRefresh?: () => void;
}

export const FavoritesList = ({ onRefresh }: FavoritesListProps) => {
  const [favorites, setFavorites] = useState<Record<string, FavoriteNode>>({});
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
          return convId;
        }
        return null;
      } catch (error) {
        console.error('Error getting conversation ID:', error);
        setError('获取对话ID失败');
        return null;
      }
    };
    
    getCurrentConversationId().then(id => {
      if (id) {
        loadFavorites(id);
      } else {
        setIsLoading(false);
      }
    });
  }, []);

  // 监听收藏状态变化事件
  useEffect(() => {
    const handleFavoriteToggled = async (event: Event) => {
      const customEvent = event as CustomEvent;
      const { nodeId, conversationId: eventConvId, action, node } = customEvent.detail;
      
      // 只处理当前对话的事件
      if (eventConvId !== conversationId) return;
      
      if (action === 'add' && node) {
        // 添加收藏
        setFavorites(prev => ({
          ...prev,
          [nodeId]: node
        }));
      } else if (action === 'remove') {
        // 移除收藏
        setFavorites(prev => {
          const newFavorites = { ...prev };
          delete newFavorites[nodeId];
          return newFavorites;
        });
      }
    };
    
    // 添加事件监听器
    window.addEventListener('favoriteToggled', handleFavoriteToggled);
    
    // 清理函数
    return () => {
      window.removeEventListener('favoriteToggled', handleFavoriteToggled);
    };
  }, [conversationId]);

  // 加载收藏列表
  const loadFavorites = async (convId: string) => {
    setIsLoading(true);
    setError(null);
    
    try {
      const result = await chrome.storage.local.get(['favorites']);
      const allFavorites = result.favorites || {};
      const conversationFavorites = allFavorites[convId] || {};
      
      setFavorites(conversationFavorites);
    } catch (error) {
      console.error('Error loading favorites:', error);
      setError('加载收藏失败');
    } finally {
      setIsLoading(false);
    }
  };

  // 刷新收藏列表
  const refreshFavorites = () => {
    if (conversationId) {
      loadFavorites(conversationId);
      // 如果提供了外部刷新函数，也调用它
      if (onRefresh) {
        onRefresh();
      }
    }
  };

  // 移除收藏
  const removeFavorite = async (nodeId: string) => {
    if (!conversationId) return;
    
    try {
      // 先更新本地状态，提供即时反馈
      setFavorites(prev => {
        const newFavorites = { ...prev };
        delete newFavorites[nodeId];
        return newFavorites;
      });
      
      // 然后更新存储
      const result = await chrome.storage.local.get(['favorites']);
      const allFavorites = result.favorites || {};
      
      if (allFavorites[conversationId] && allFavorites[conversationId][nodeId]) {
        delete allFavorites[conversationId][nodeId];
        await chrome.storage.local.set({ favorites: allFavorites });
        
        // 发送自定义事件，通知 CustomNode 组件更新
        const event = new CustomEvent('favoriteRemoved', { 
          detail: { 
            nodeId, 
            conversationId 
          } 
        });
        window.dispatchEvent(event);
      }
    } catch (error) {
      console.error('Error removing favorite:', error);
      // 如果出错，恢复原始状态
      refreshFavorites();
    }
  };

  // 滚动到指定节点
  const scrollToNode = (nodeId: string) => {
    try {
      const nodeElement = document.querySelector(`[data-id="${nodeId}"]`);
      if (nodeElement) {
        nodeElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
        
        // 高亮显示节点
        nodeElement.classList.add('highlight-node');
        setTimeout(() => {
          nodeElement.classList.remove('highlight-node');
        }, 2000);
      }
    } catch (error) {
      console.error('Error scrolling to node:', error);
    }
  };

  // 渲染收藏列表
  return (
    <div className="favorites-list p-2" style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10, background: 'white', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
      <div className="flex justify-between items-center mb-2">
        <h3 className="text-lg font-medium">收藏消息：</h3>
      </div>

      {/* 显示加载状态或错误 */}
      {isLoading && <div className="text-gray-500">加载中...</div>}
      {error && <div className="text-red-500">{error}</div>}

      {/* 收藏列表 */}
      <div className="favorites-tabs flex flex-wrap gap-2 mt-2 overflow-x-auto pb-2">
        {Object.values(favorites).length === 0 && !isLoading ? (
          null
        ) : (
          Object.values(favorites).map(favorite => (
            <div
              key={favorite.id}
              className={`favorite-tab px-3 py-1 rounded-full text-sm flex items-center ${
                favorite.role === 'user' ? 'bg-yellow-50 border border-yellow-200' : 'bg-gray-50 border-gray-200'
              } hover:bg-opacity-80 transition-colors cursor-pointer`}
              onClick={() => scrollToNode(favorite.id)}
            >
              <span className="truncate max-w-[150px]">{favorite.name}</span>
              <button
                className="ml-2 text-gray-400 hover:text-red-500"
                onClick={(e) => {
                  e.stopPropagation(); // 阻止事件冒泡
                  removeFavorite(favorite.id);
                }}
                title="删除收藏"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
};