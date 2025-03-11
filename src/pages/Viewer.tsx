import { useState, useCallback, useRef } from 'react';
import { ReactFlow, Background, Controls, NodeTypes } from '@xyflow/react';
import { CustomNode } from '../components/CustomNode';
import { createNodesInOrder } from '../utils/nodeCreation';
import '@xyflow/react/dist/style.css';

const nodeTypes: NodeTypes = {
  custom: CustomNode,
};

const Viewer = () => {
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reactFlowInstance = useRef<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsLoading(true);
    setError(null);

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const content = e.target?.result as string;
        const conversationData = JSON.parse(content);
        
        // 模拟checkNodes函数，因为我们不需要检查DOM
        const mockCheckNodes = async (nodeIds: string[]) => {
          return nodeIds.map(() => true);
        };

        const { nodes: newNodes, edges: newEdges } = await createNodesInOrder(conversationData, mockCheckNodes);
        setNodes(newNodes as any);
        setEdges(newEdges as any);
        
        // 自动适应视图
        setTimeout(() => reactFlowInstance.current?.fitView(), 100);
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
  }, []);

  const triggerFileInput = () => {
    fileInputRef.current?.click();
  };

  return (
    <div className="w-full h-screen flex flex-col">
      <div className="bg-gray-100 p-4 flex justify-between items-center">
        <h1 className="text-xl font-bold">ChatTree 查看器</h1>
        <div>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileUpload}
            accept=".json"
            className="hidden"
          />
          <button
            onClick={triggerFileInput}
            className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded transition-colors"
          >
            导入对话树
          </button>
        </div>
      </div>

      <div className="flex-1 relative">
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-white bg-opacity-70 z-10">
            <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
          </div>
        )}

        {error && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
              <p>{error}</p>
            </div>
          </div>
        )}

        {!nodes.length && !isLoading && !error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-500">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-16 w-16 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <p className="text-xl">请导入对话树JSON文件</p>
            <button
              onClick={triggerFileInput}
              className="mt-4 text-blue-500 hover:text-blue-600 underline"
            >
              选择文件
            </button>
          </div>
        )}

        {nodes.length > 0 && (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onInit={(instance) => (reactFlowInstance.current = instance)}
            fitView
          >
            <Background />
            <Controls />
          </ReactFlow>
        )}
      </div>
    </div>
  );
};

export default Viewer; 