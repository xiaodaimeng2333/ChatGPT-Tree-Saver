import { useCallback, useEffect } from 'react';
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
    onEdgesChange
  } = useConversationTree();

  // Fetch conversation history from Chrome extension
  const fetchConversationData = useCallback(async () => {
    setIsLoading(true);
    try {
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
  }, [setConversationData, setIsLoading, reactFlowInstance]);

  // Create nodes and edges when conversation data changes
  useEffect(() => {
    if (conversationData) {
      createNodesInOrder(conversationData, checkNodes)
        .then(({ nodes: newNodes, edges: newEdges }) => {
          setNodes(newNodes as any);
          setEdges(newEdges as any);
          setIsLoading(false);
        })
        .catch(error => {
          console.error(error);
          setIsLoading(false);
        });
    }
  }, [conversationData]);

  // Add another useEffect to handle initial data fetch and URL changes
  useEffect(() => {
    // 初始加载数据
    fetchConversationData();

    // 监听来自 background.js 的消息
    const handleMessage = (message: any) => {
      if (message.action === "urlChanged") {
        console.log('Received URL change notification:', message.url);
        fetchConversationData();
      }
    };

    // 添加消息监听器
    chrome.runtime.onMessage.addListener(handleMessage);

    // 清理函数
    return () => {
      chrome.runtime.onMessage.removeListener(handleMessage);
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
  if (!conversationData) return <ErrorState />;

  return (
    <div className="w-full h-full" style={{ height: '100%', width: '100%' }}>
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
