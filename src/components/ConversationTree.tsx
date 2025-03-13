import { useCallback, useEffect, useState } from 'react';
import { ReactFlow, addEdge, Connection, MiniMap, Controls, Background, BackgroundVariant, NodeTypes } from '@xyflow/react';
import { ContextMenu } from './ContextMenu';
import { LoadingSpinner, ErrorState } from "./LoadingStates";
import { useConversationTree } from '../hooks/useConversationTree';
import { createContextMenuHandler, checkNodes } from '../utils/conversationTreeHandlers';
import { createNodesInOrder } from '../utils/nodeCreation';
import { calculateSteps } from '../utils/nodeNavigation';
import { RefreshButton } from './RefreshButton';
import { SaveButton } from './SaveButton';
import { ViewerButton } from './ViewerButton';
import { CustomNode } from "./CustomNode";
import { FavoritesList } from './FavoritesList';
import '@xyflow/react/dist/style.css';


const nodeTypes: NodeTypes = {
    custom: CustomNode,
  };

const ConversationTree = () => {
  // Custom hook providing state and handlers for the conversation tree
  const {
    nodes,
    setNodes,
    edges,
    setEdges,
    conversationData,
    setConversationData,
    isLoading,
    setIsLoading,
    menu,
    setMenu,
    ref,
    reactFlowInstance,
    onNodesChange,
    onEdgesChange,
    isDebugMode,
    // @ts-ignore - 保留此状态以供其他组件使用
    setIsDebugMode
  } = useConversationTree();
  
  // 新增状态：标记当前是否不在 ChatGPT 页面
  const [isNotChatGptPage, setIsNotChatGptPage] = useState(false);

  // Fetch conversation history from Chrome extension
  const fetchConversationData = useCallback(async () => {
    setIsLoading(true);
    try {
      // 首先检查当前页面是否是 ChatGPT 对话页面
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const currentTab = tabs[0];
      
      // 检查URL是否包含chatgpt.com/c/（普通对话）或chatgpt.com/g/（GPTs对话）
      const isChatGptPage = currentTab?.url && (
        currentTab.url.includes('chatgpt.com/c/') || 
        currentTab.url.includes('chatgpt.com/g/')
      );
      
      if (!isChatGptPage) {
        console.log('当前页面不是 ChatGPT 对话页面:', currentTab?.url);
        setIsNotChatGptPage(true);
        setIsLoading(false);
        return;
      }
      
      // 页面有效，重置标记
      setIsNotChatGptPage(false);
      
      const response = await chrome.runtime.sendMessage({ action: "fetchConversationHistory" });
      if (response.success) {
        setConversationData(response.data);
        // Fit view after nodes are rendered
        setTimeout(() => reactFlowInstance.current?.fitView(), 100);
      } else {
        console.error('Failed to fetch conversation data:', response.error);
      }
    } catch (error) {
      console.error('Error fetching conversation data:', error);
    } finally {
      setIsLoading(false);
    }
  }, [setConversationData, setIsLoading, reactFlowInstance, setIsNotChatGptPage]);

  // Create nodes and edges when conversation data changes
  useEffect(() => {
    if (!conversationData) {
      return;
    }
    
    createNodesInOrder(conversationData, checkNodes)
      .then(({ nodes: newNodes, edges: newEdges }) => {
        setNodes(newNodes.map(node => ({
          ...node,
          data: {
            ...node.data,
            isDebugMode
          }
        })) as any);
        setEdges(newEdges as any);
        setIsLoading(false);
      })
      .catch(error => {
        // 直接将错误传递给浏览器，这样会在Chrome的错误提示中显示
        setTimeout(() => { throw error; }, 0);
        setIsLoading(false);
      });
  }, [conversationData, isDebugMode]);

  // Add another useEffect to handle initial data fetch and URL changes
  useEffect(() => {
    console.log('Setting up URL change listeners and initial data fetch');
    // 初始加载数据
    fetchConversationData();

    // 上次检查的 URL
    let lastUrl = '';

    // 监听来自 background.js 的消息
    const handleMessage = (message: any) => {
      console.log('Received message:', message);
      if (message.action === "urlChanged") {
        console.log('Received URL change notification:', message.url);
        fetchConversationData();
      }
      // 返回 true 以保持消息通道开放
      return true;
    };

    // 添加消息监听器
    chrome.runtime.onMessage.addListener(handleMessage);
    console.log('Message listener added');

    // 备用方案：定期检查 URL 变化
    const checkUrlInterval = setInterval(async () => {
      try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const currentTab = tabs[0];
        
        // 检查URL是否包含chatgpt.com/c/（普通对话）或chatgpt.com/g/（GPTs对话）
        const isChatGptPage = currentTab?.url && (
          currentTab.url.includes('chatgpt.com/c/') || 
          currentTab.url.includes('chatgpt.com/g/')
        );
        
        if (isChatGptPage) {
          if (lastUrl && lastUrl !== currentTab.url) {
            console.log('URL changed (detected by polling):', currentTab.url);
            fetchConversationData();
          }
          lastUrl = currentTab.url || '';
        }
      } catch (error) {
        console.error('Error checking URL:', error);
      }
    }, 2000); // 每 2 秒检查一次

    // 清理函数
    return () => {
      console.log('Cleaning up URL change listeners');
      chrome.runtime.onMessage.removeListener(handleMessage);
      clearInterval(checkUrlInterval);
    };
  }, [fetchConversationData]);

  // Update nodes visibility by checking if they still exist in the DOM
  const updateNodesVisibility = useCallback(async () => {
    const nodeIds = nodes.map((node: any) => node.id);
    const existingNodes = await checkNodes(nodeIds);
    
    setNodes((prevNodes: any) => 
        prevNodes.map((node: any, index: number) => ({
            ...node,
            data: {
                ...node.data,
                hidden: existingNodes[index]
            }
        }))
    );
  }, [nodes]);

  // Calculate navigation steps when a node is clicked
  const handleNodeClick = useCallback((messageId: string) => {
    setMenu(null);
    return calculateSteps(nodes, messageId);
  }, [nodes]);

  const onNodeContextMenu = useCallback(
    createContextMenuHandler(ref, setMenu),
    [ref, setMenu]
  );

  const onPaneClick = useCallback(() => setMenu(null), [setMenu]);
  const onConnect = useCallback(
    (params: Connection) => setEdges((eds) => addEdge(params, eds)),
    [setEdges]
  );

  // Add handleSave function
  const handleSave = useCallback(() => {
    if (!conversationData) return;
    
    // Create a JSON file with the conversation data
    const dataStr = JSON.stringify(conversationData, null, 2);
    const dataUri = `data:application/json;charset=utf-8,${encodeURIComponent(dataStr)}`;
    
    // Use conversation title as filename, fallback to timestamp if no title
    const fileName = conversationData.title 
      ? `${conversationData.title.replace(/[\\/:*?"<>|]/g, '-')}.json` 
      : `chat-tree-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    
    // Create a download link and trigger it
    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', fileName);
    linkElement.style.display = 'none';
    document.body.appendChild(linkElement);
    linkElement.click();
    document.body.removeChild(linkElement);
  }, [conversationData]);

  // Add handleOpenViewer function
  const handleOpenViewer = useCallback(() => {
    // 使用绝对URL而不是相对URL
    const viewerUrl = chrome.runtime.getURL('viewer.html');
    console.log('Opening viewer at:', viewerUrl);
    
    // 打开查看器页面
    chrome.tabs.create({ url: viewerUrl });
  }, []);

  if (isLoading) return <LoadingSpinner />;
  if (isNotChatGptPage) return (
    <div className="flex flex-col items-center justify-center h-full w-full p-4 text-center">
      <div className="text-xl font-bold mb-2">非 ChatGPT 对话页面</div>
      <p className="text-gray-600 mb-4">请在 ChatGPT 对话页面使用此扩展</p>
      <p className="text-sm text-gray-500">导航到 chatgpt.com 并打开一个对话</p>
    </div>
  );
  if (!conversationData) return <ErrorState />;

  return (
    <div className="w-full h-full" style={{ height: '100%', width: '100%' }}>
      <FavoritesList onRefresh={() => fetchConversationData()} nodes={nodes} />
      <RefreshButton onClick={fetchConversationData} />
      <SaveButton onClick={handleSave} />
      <ViewerButton onClick={handleOpenViewer} />
      <ReactFlow
        ref={ref}
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        nodeTypes={nodeTypes}
        onNodeContextMenu={onNodeContextMenu}
        onPaneClick={onPaneClick}
        onInit={instance => { reactFlowInstance.current = instance; }}
        fitView
        proOptions={{ hideAttribution: true }}
        minZoom={0.1}
        maxZoom={1.5}
        defaultViewport={{ x: 0, y: 0, zoom: 0.8 }}
      >
        <Controls className="bg-white rounded-lg shadow-lg" />
        <MiniMap 
          nodeColor={(node) => node.data?.role === 'user' ? '#fefce8' : '#f9fafb'}
          className="bg-white rounded-lg shadow-lg"
        />
        <Background variant={BackgroundVariant.Dots} gap={12} size={1} color="#f1f1f1" />
        {menu && <ContextMenu 
          onClick={onPaneClick} 
          onNodeClick={handleNodeClick} 
          onRefresh={updateNodesVisibility}
          refreshNodes={fetchConversationData}
          {...menu} 
        />}
      </ReactFlow>
    </div>
  );
};


export default ConversationTree;
