import React, { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import './pages/Viewer.css';

// 定义收藏消息的接口
interface FavoriteMessage {
  id: string;
  name: string;
  messageId: string;
}

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
  favorites?: FavoriteMessage[];
}

// 定义历史记录类型
interface HistoryState {
  deletedNodesArray: string[]; // 改为数组类型
  deletedFavorites: FavoriteMessage[]; // 添加被删除的收藏
}

const Viewer: React.FC = () => {
  const [messages, setMessages] = useState<Record<string, Message>>({});
  const [currentPath, setCurrentPath] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDebugMode, setIsDebugMode] = useState(false);
  const [debugLogs, setDebugLogs] = useState<string[]>([]);
  // 收藏相关状态
  const [favorites, setFavorites] = useState<FavoriteMessage[]>([]);
  const [nameInputMessageId, setNameInputMessageId] = useState<string | null>(null);
  const [nameInputValue, setNameInputValue] = useState('');
  // 添加原始数据引用
  const [originalData, setOriginalData] = useState<ConversationData | null>(null);
  // 添加原始文件名记录
  const [originalFileName, setOriginalFileName] = useState<string>('');
  
  // 修改历史状态管理
  const [history, setHistory] = useState<HistoryState[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [deletedNodes, setDeletedNodes] = useState<Set<string>>(new Set());
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  const addLog = (message: string) => {
    console.log(message);
    setDebugLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${message}`]);
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // 记录原始文件名
    setOriginalFileName(file.name);
    console.log('开始处理文件:', file.name, '大小:', file.size, 'bytes');
    setIsLoading(true);
    setError(null);
    
    // 重置历史和删除节点状态
    setHistory([]);
    setHistoryIndex(-1);
    setDeletedNodes(new Set());

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        console.log('文件内容长度:', content.length);
        
        // 尝试解析 JSON
        let data;
        try {
          data = JSON.parse(content) as ConversationData;
          // 将原始数据保存到状态，以便后续保存收藏
          setOriginalData(data);
          // 将原始 mapping 数据保存到 window 对象中，以便后续使用
          (window as any).originalMapping = data.mapping;
        } catch (parseError: any) {
          console.error('JSON 解析错误:', parseError);
          setError(`JSON 解析错误: ${parseError.message}`);
          setIsLoading(false);
          return;
        }
        
        console.log('数据解析成功, 标题:', (data as any).title || '无标题');
        console.log('对话节点数量:', Object.keys(data.mapping || {}).length);
        
        // 检查是否有保存的收藏信息
        if (data.favorites && Array.isArray(data.favorites)) {
          console.log('从文件中恢复收藏信息, 收藏数量:', data.favorites.length);
          setFavorites(data.favorites);
        } else {
          console.log('文件中无收藏信息');
          setFavorites([]);
        }
        
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

      // 没有子节点时退出循环
      if (node.children.length === 0) {
        break;
      }

      // 选择时间最靠后的子节点
      if (node.children.length === 1) {
        // 只有一个子节点时直接选择
        currentId = node.children[0];
      } else {
        // 多个子节点时，找出时间最靠后的那个
        let latestChildId = node.children[0];
        let latestTime = 0;
        
        for (const childId of node.children) {
          const childNode = mapping[childId];
          const createTime = childNode?.message?.create_time || 0;
          
          if (createTime > latestTime) {
            latestTime = createTime;
            latestChildId = childId;
          }
        }
        
        console.log(`选择了时间最靠后的子节点: ${latestChildId}, 时间戳: ${latestTime}`);
        currentId = latestChildId;
      }
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
      
      // 没有子节点时退出循环
      if (node.children.length === 0) {
        break;
      }
      
      // 选择时间最靠后的子节点
      if (node.children.length === 1) {
        // 只有一个子节点时直接选择
        currentId = node.children[0];
      } else {
        // 多个子节点时，找出时间最靠后的那个
        let latestChildId = node.children[0];
        let latestTime = 0;
        
        for (const childId of node.children) {
          // 由于 messages 中没有 create_time，我们需要从原始数据中获取
          const originalNode = (window as any).originalMapping?.[childId];
          const createTime = originalNode?.message?.create_time || 0;
          
          if (createTime > latestTime) {
            latestTime = createTime;
            latestChildId = childId;
          }
        }
        
        console.log(`切换分支：选择了时间最靠后的子节点: ${latestChildId}, 时间戳: ${latestTime}`);
        currentId = latestChildId;
      }
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

  // 添加一个新函数，用于导航到最新分支
  const navigateToLatest = () => {
    if (!Object.keys(messages).length || !(window as any).originalMapping) {
      console.log('没有可用的对话数据');
      return;
    }
    
    console.log('开始寻找并导航到最新分支');
    const mapping = (window as any).originalMapping;
    
    // 从根节点开始
    const rootId = Object.keys(mapping).find(id => !mapping[id].parent);
    if (!rootId) {
      console.warn('找不到根节点');
      return;
    }
    
    // 构建到最新分支的路径
    const newPath: string[] = [];
    let currentId = rootId;
    
    while (currentId) {
      newPath.push(currentId);
      const node = messages[currentId];
      
      if (!node) {
        console.warn('路径中的节点不存在:', currentId);
        break;
      }
      
      // 没有子节点时退出循环
      if (node.children.length === 0) {
        break;
      }
      
      // 选择时间最靠后的子节点
      if (node.children.length === 1) {
        // 只有一个子节点时直接选择
        currentId = node.children[0];
      } else {
        // 多个子节点时，找出时间最靠后的那个
        let latestChildId = node.children[0];
        let latestTime = 0;
        
        for (const childId of node.children) {
          const originalNode = mapping[childId];
          const createTime = originalNode?.message?.create_time || 0;
          
          if (createTime > latestTime) {
            latestTime = createTime;
            latestChildId = childId;
          }
        }
        
        console.log(`选择了时间最靠后的子节点: ${latestChildId}, 时间戳: ${latestTime}`);
        currentId = latestChildId;
      }
    }
    
    console.log('新路径构建完成, 长度:', newPath.length);
    if (newPath.length > 0) {
      setCurrentPath(newPath);
      // 滚动到底部
      setTimeout(() => {
        chatContainerRef.current?.scrollTo({
          top: chatContainerRef.current.scrollHeight,
          behavior: 'smooth'
        });
      }, 100);
    }
  };

  // 完全重写寻找最长分支的函数
  const navigateToLongest = () => {
    if (!Object.keys(messages).length) {
      addLog('没有可用的对话数据');
      return;
    }
    
    setDebugLogs([]); // 清空之前的日志
    addLog('开始寻找并导航到最长分支');
    
    // 获取所有消息 - 不再过滤隐藏节点
    // 因为隐藏节点可能是连接链路中的关键部分
    const allMessages = {...messages};
    
    addLog(`总消息节点数: ${Object.keys(allMessages).length}`);
    
    // 查找根节点
    const rootId = Object.keys(allMessages).find(id => !allMessages[id].parent);
    if (!rootId) {
      addLog('错误：找不到根节点');
      return;
    }
    
    addLog(`找到根节点: ${rootId}`);
    
    // 构建全量的邻接表 (包含隐藏节点)
    const adjacencyList: Record<string, string[]> = {};
    Object.keys(allMessages).forEach(id => {
      adjacencyList[id] = allMessages[id].children;
      
      // 验证子节点是否存在
      adjacencyList[id].forEach(childId => {
        if (!allMessages[childId]) {
          addLog(`警告: 节点 ${id} 的子节点 ${childId} 不存在于消息集合中`);
        }
      });
    });
    
    // 查找所有叶子节点(没有子节点的节点)
    const leafNodes = Object.keys(adjacencyList).filter(id => 
      adjacencyList[id].length === 0
    );
    
    addLog(`邻接表中有 ${Object.keys(adjacencyList).length} 个节点, 其中有 ${leafNodes.length} 个叶子节点`);
    
    // 报告分支节点数量
    const branchingNodes = Object.entries(adjacencyList)
      .filter(([_, children]) => children.length > 1)
      .map(([id]) => id);
    
    addLog(`树中有 ${branchingNodes.length} 个分支节点（有多个子节点的节点）`);
    if (branchingNodes.length > 0) {
      addLog(`前5个分支节点: ${branchingNodes.slice(0, 5).join(', ')}`);
    }
    
    // 尝试从根节点到每个叶子节点找最长路径
    let longestPath: string[] = [];
    
    // 从根节点到每个叶子节点的路径查找
    for (const leafId of leafNodes) {
      // 使用广度优先搜索找出从根到此叶子的路径
      const path = findPathBetween(rootId, leafId, adjacencyList);
      
      if (path.length > longestPath.length) {
        longestPath = path;
        addLog(`找到新的最长路径，长度为 ${path.length}，从根到叶子 ${leafId}`);
      }
    }
    
    // 如果找不到路径，尝试一种不同的方法，直接基于邻接表进行BFS
    if (longestPath.length < 3) {
      addLog('未找到合适的最长路径，尝试使用直接遍历方法...');
      
      const paths = findAllPaths(rootId, adjacencyList);
      if (paths.length > 0) {
        // 找出最长的路径
        longestPath = paths.reduce((longest, current) => 
          current.length > longest.length ? current : longest, paths[0]);
          
        addLog(`通过直接遍历找到最长路径，长度为 ${longestPath.length}`);
      }
    }
    
    if (longestPath.length === 0) {
      addLog('错误：无法找到任何有效路径');
      return;
    }
    
    // 从最长路径中过滤出可见节点，用于显示
    const visiblePath = longestPath.filter(id => !messages[id]?.hidden);
    
    addLog(`最长路径总长度: ${longestPath.length}, 可见节点数: ${visiblePath.length}`);
    
    // 分段显示长路径，便于调试
    if (longestPath.length > 20) {
      addLog(`路径开头: ${longestPath.slice(0, 10).join(' -> ')}`);
      addLog(`路径中间: ... 省略 ${longestPath.length - 20} 个节点 ...`);
      addLog(`路径结尾: ${longestPath.slice(-10).join(' -> ')}`);
    } else {
      addLog(`完整路径: ${longestPath.join(' -> ')}`);
    }
    
    // 设置路径并滚动到底部
    setCurrentPath(visiblePath.length > 0 ? visiblePath : longestPath);
    addLog(`设置新路径完成，完整长度: ${longestPath.length}, 显示的节点数: ${visiblePath.length}`);
    
    setTimeout(() => {
      chatContainerRef.current?.scrollTo({
        top: chatContainerRef.current.scrollHeight,
        behavior: 'smooth'
      });
    }, 100);
  };
  
  // 查找从起点到终点的路径
  const findPathBetween = (startId: string, endId: string, adjacencyList: Record<string, string[]>): string[] => {
    // 使用BFS查找路径
    const queue: {nodeId: string; path: string[]}[] = [{nodeId: startId, path: [startId]}];
    const visited = new Set<string>();
    
    while (queue.length > 0) {
      const {nodeId, path} = queue.shift()!;
      
      if (nodeId === endId) {
        return path;
      }
      
      if (visited.has(nodeId)) continue;
      visited.add(nodeId);
      
      for (const childId of adjacencyList[nodeId] || []) {
        if (!visited.has(childId)) {
          queue.push({
            nodeId: childId,
            path: [...path, childId]
          });
        }
      }
    }
    
    return []; // 如果找不到路径，返回空数组
  };
  
  // 使用DFS找出所有从根节点出发的路径
  const findAllPaths = (rootId: string, adjacencyList: Record<string, string[]>): string[][] => {
    const allPaths: string[][] = [];
    const dfs = (nodeId: string, currentPath: string[] = []) => {
      currentPath = [...currentPath, nodeId];
      
      // 如果是叶子节点或已经没有更多子节点
      const children = adjacencyList[nodeId] || [];
      if (children.length === 0) {
        allPaths.push(currentPath);
        return;
      }
      
      // 遍历所有子节点
      for (const childId of children) {
        // 防止循环引用
        if (!currentPath.includes(childId)) {
          dfs(childId, currentPath);
        }
      }
    };
    
    dfs(rootId);
    return allPaths;
  };

  // 修改deleteNode函数，以正确记录将被删除的节点
  const deleteNode = (nodeId: string) => {
    if (!messages[nodeId]) {
      addLog(`节点 ${nodeId} 不存在`);
      return;
    }
    
    // 获取要删除的所有节点
    const nodesToDelete = new Set<string>();
    
    // 深度优先搜索收集所有子节点
    const collectNodesToDelete = (id: string) => {
      nodesToDelete.add(id);
      
      const node = messages[id];
      if (node && node.children) {
        for (const childId of node.children) {
          collectNodesToDelete(childId);
        }
      }
    };
    
    collectNodesToDelete(nodeId);
    
    // 查找将被删除的收藏
    const nodesToDeleteArray = Array.from(nodesToDelete);
    const favoritesToRemove = favorites.filter(fav => nodesToDeleteArray.includes(fav.messageId));
    
    // 保存当前状态前，将即将删除的收藏和节点存入历史
    // 注意：这里只保存本次要删除的节点，而不是全部deletedNodes
    const prevDeletedNodes = Array.from(deletedNodes);
    const newHistoryState = {
      deletedNodesArray: [...prevDeletedNodes],
      deletedFavorites: [] // 初始化为空数组
    };
    
    // 如果我们在历史记录中间进行了修改，则删除之后的历史
    const newHistory = history.slice(0, historyIndex + 1);
    
    // 添加新状态
    newHistory.push(newHistoryState);
    
    // 如果历史记录过长，则限制其长度
    const MAX_HISTORY_LENGTH = 30;
    if (newHistory.length > MAX_HISTORY_LENGTH) {
      newHistory.shift();
    }
    
    // 更新历史记录
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
    
    addLog(`已保存删除前状态到历史记录 #${newHistory.length - 1}`);
    
    // 更新删除的节点集合
    setDeletedNodes(prev => {
      const newSet = new Set(prev);
      nodesToDelete.forEach(id => newSet.add(id));
      return newSet;
    });
    
    // 同时删除被删除节点的收藏
    if (favoritesToRemove.length > 0) {
      setFavorites(prev => {
        const newFavorites = prev.filter(fav => !nodesToDeleteArray.includes(fav.messageId));
        // 更新原始数据中的收藏
        updateOriginalDataFavorites(newFavorites);
        return newFavorites;
      });
      // 添加被删除的收藏到当前历史记录
      newHistory[newHistory.length - 1].deletedFavorites = [...favoritesToRemove];
      addLog(`删除节点时，同时移除了 ${favoritesToRemove.length} 个相关的收藏`);
    }
    
    // 更新当前路径，排除被删除的节点
    const newPath = currentPath.filter(id => !nodesToDelete.has(id));
    
    // 如果删除了当前路径上的节点，需要寻找替代路径
    if (newPath.length < currentPath.length) {
      // 如果删除的是当前路径的节点，重新构建路径
      if (nodesToDelete.has(nodeId)) {
        addLog(`删除了当前路径上的节点，正在调整路径...`);
        
        // 如果删除的是根节点，则清空路径
        if (messages[nodeId].parent === undefined) {
          setCurrentPath([]);
        } else {
          // 查找删除节点的父节点在路径中的位置
          const parentId = messages[nodeId].parent;
          if (parentId && newPath.includes(parentId)) {
            // 从父节点往下建立新路径
            const newPathFromParent = buildPathFromNode(parentId, new Set(nodesToDelete));
            const parentIndex = newPath.indexOf(parentId);
            
            // 合并路径：保留父节点之前的路径，加上从父节点往下的新路径
            setCurrentPath([...newPath.slice(0, parentIndex + 1), ...newPathFromParent.slice(1)]);
            addLog(`建立了新路径，从父节点 ${parentId} 开始`);
          } else {
            setCurrentPath(newPath);
          }
        }
      } else {
        setCurrentPath(newPath);
      }
    }
    
    addLog(`已删除节点 ${nodeId} 及其所有子节点，共 ${nodesToDelete.size} 个节点`);
  };
  
  // 构建从指定节点开始的路径，避开已删除的节点
  const buildPathFromNode = (startNodeId: string, nodesToAvoid: Set<string>): string[] => {
    const path = [startNodeId];
    let currentId = startNodeId;
    
    // 从起始节点开始，尝试往下构建路径
    while (currentId) {
      const node = messages[currentId];
      if (!node || node.children.length === 0) {
        break; // 到达叶子节点
      }
      
      // 找出未被删除的子节点
      const validChildren = node.children.filter(id => !nodesToAvoid.has(id));
      
      if (validChildren.length === 0) {
        break; // 没有有效的子节点
      }
      
      // 优先选择时间最新的子节点
      if (validChildren.length === 1) {
        currentId = validChildren[0];
      } else {
        // 多个子节点时，选择时间最靠后的
        let latestChildId = validChildren[0];
        let latestTime = 0;
        
        for (const childId of validChildren) {
          const originalNode = (window as any).originalMapping?.[childId];
          const createTime = originalNode?.message?.create_time || 0;
          
          if (createTime > latestTime) {
            latestTime = createTime;
            latestChildId = childId;
          }
        }
        
        currentId = latestChildId;
      }
      
      path.push(currentId);
    }
    
    return path;
  };
  
  // 重写撤销操作以修复恢复逻辑
  const undo = () => {
    if (historyIndex > 0) {
      // 上一个历史状态包含删除操作前的状态
      const prevState = history[historyIndex - 1];
      // 当前状态是删除后的状态
      const currentDeletedNodesSet = new Set(deletedNodes);
      // 上一个状态的删除节点集合
      const prevDeletedNodesSet = new Set(prevState.deletedNodesArray);
      
      // 找出当前被删除但在之前状态中不存在的节点 - 这些是需要恢复的节点
      const nodesToRestore = new Set<string>();
      currentDeletedNodesSet.forEach(nodeId => {
        if (!prevDeletedNodesSet.has(nodeId)) {
          nodesToRestore.add(nodeId);
        }
      });
      
      // 如果没有节点需要恢复，可能是数据问题，直接返回
      if (nodesToRestore.size === 0) {
        addLog("没有找到需要恢复的节点，可能有数据错误");
        return;
      }
      
      addLog(`将恢复 ${nodesToRestore.size} 个节点`);
      
      // 恢复收藏 - 直接从历史记录中获取被删除的收藏
      const deletedFavoritesToRestore = history[historyIndex].deletedFavorites || [];
      
      if (deletedFavoritesToRestore.length > 0) {
        addLog(`将恢复 ${deletedFavoritesToRestore.length} 个收藏`);
        
        // 添加回这些收藏
        setFavorites(prev => {
          // 检查是否存在重复
          const existingIds = new Set(prev.map(f => f.id));
          const uniqueFavoritesToRestore = deletedFavoritesToRestore.filter(f => !existingIds.has(f.id));
          
          addLog(`实际恢复了 ${uniqueFavoritesToRestore.length} 个不重复的收藏`);
          
          const newFavorites = [...prev, ...uniqueFavoritesToRestore];
          // 更新原始数据中的收藏
          updateOriginalDataFavorites(newFavorites);
          return newFavorites;
        });
      }
      
      // 先还原为历史状态中的deletedNodes，以便后续能正确构建路径
      setDeletedNodes(prevDeletedNodesSet);
      
      // 更新历史索引
      setHistoryIndex(historyIndex - 1);
      
      // 找出一个要跳转的节点（通常选择第一个恢复的节点）
      const nodeToFocus = Array.from(nodesToRestore)[0];
      
      // 检查是否能找到这个节点
      if (nodeToFocus && messages[nodeToFocus]) {
        // 构建一条包含这个恢复节点的路径
        const newPath = buildPathToMessage(nodeToFocus);
        
        if (newPath.length > 0) {
          // 切换到这条新路径
          setCurrentPath(newPath);
          
          // 延迟滚动到恢复的节点
          setTimeout(() => {
            const messageElement = document.getElementById(`message-${nodeToFocus}`);
            if (messageElement) {
              messageElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
              messageElement.classList.add('highlight-message');
              setTimeout(() => {
                messageElement.classList.remove('highlight-message');
              }, 2000);
            }
          }, 100);
          
          addLog(`已切换路径到恢复的节点 ${nodeToFocus}`);
        } else {
          addLog(`无法构建到恢复节点 ${nodeToFocus} 的路径`);
        }
      } else {
        // 如果找不到特定节点，尝试重新评估当前路径
        adjustPathAfterUndo(nodesToRestore);
      }
      
      addLog(`已撤销删除操作到历史记录 #${historyIndex - 1}，恢复了 ${nodesToRestore.size} 个节点`);
    } else {
      addLog('没有可撤销的删除操作');
    }
  };

  // 检查路径中是否需要调整显示，处理恢复节点后的路径调整
  const adjustPathAfterUndo = (restoredNodes: Set<string>) => {
    if (restoredNodes.size === 0) {
      addLog("没有找到任何已恢复的节点，可能撤销操作出现问题");
      return;
    }
    
    addLog(`恢复了 ${restoredNodes.size} 个被删除的节点`);
    
    // 检查这些恢复的节点是否影响当前路径的显示
    // 我们不改变路径，只是检查当前路径是否应该显示更多节点
    let pathChanged = false;
    
    // 如果当前路径为空（所有节点都被删除），并且恢复了根节点，重新构建初始路径
    if (currentPath.length === 0) {
      // 查找根节点
      const rootId = Object.keys(messages).find(id => !messages[id].parent);
      if (rootId && restoredNodes.has(rootId)) {
        // 重新构建完整路径
        const newPath = buildPathFromNode(rootId, deletedNodes);
        if (newPath.length > 0) {
          addLog(`恢复了根节点，重新构建路径，长度: ${newPath.length}`);
          setCurrentPath(newPath);
          pathChanged = true;
        }
      }
    }
    
    // 如果恢复了当前路径中缺失的节点，保持当前路径的当前位置
    if (!pathChanged) {
      // 我们只记录日志，实际上不需要修改路径，因为节点的显示/隐藏是通过过滤deletedNodes实现的
      const restoredPathNodes = [...restoredNodes].filter(id => {
        // 检查这个节点是否应该在当前路径上
        // 1. 检查它是否有父节点在当前路径上
        const parent = messages[id]?.parent;
        const parentInPath = parent && currentPath.includes(parent);
        
        // 2. 并且该节点是父节点的唯一子节点或时间最新的子节点
        if (parentInPath) {
          const parentNode = messages[parent];
          // 如果只有一个子节点
          if (parentNode.children.length === 1) return true;
          
          // 多个子节点，检查是否是时间最新的
          let latestChildId = '';
          let latestTime = 0;
          
          for (const childId of parentNode.children) {
            if (deletedNodes.has(childId)) continue; // 跳过仍然被删除的节点
            
            const originalNode = (window as any).originalMapping?.[childId];
            const createTime = originalNode?.message?.create_time || 0;
            
            if (createTime > latestTime) {
              latestTime = createTime;
              latestChildId = childId;
            }
          }
          
          return id === latestChildId;
        }
        
        return false;
      });
      
      if (restoredPathNodes.length > 0) {
        addLog(`恢复的节点中，有 ${restoredPathNodes.length} 个可能影响当前路径显示`);
      }
    }
  };

  // 收藏相关功能应该不受撤销/恢复影响
  const handleFavoriteClick = (messageId: string) => {
    // 检查是否已经收藏，如果是则移除收藏
    const existingFavorite = favorites.find(f => f.messageId === messageId);
    if (existingFavorite) {
      // 已收藏，移除
      setFavorites(prev => {
        const newFavorites = prev.filter(f => f.messageId !== messageId);
        // 更新原始数据中的收藏
        updateOriginalDataFavorites(newFavorites);
        return newFavorites;
      });
      addLog(`已从收藏中移除消息 ${messageId}`);
    } else {
      // 未收藏，显示输入框添加收藏
      setNameInputMessageId(messageId);
      setNameInputValue('');
      // 聚焦到输入框
      setTimeout(() => {
        nameInputRef.current?.focus();
      }, 0);
    }
  };

  // 更新原始数据中的收藏信息
  const updateOriginalDataFavorites = (newFavorites: FavoriteMessage[]) => {
    if (originalData) {
      // 更新原始数据中的收藏
      originalData.favorites = newFavorites;
      console.log('已更新原始数据中的收藏信息, 数量:', newFavorites.length);
    }
  };

  // 处理收藏命名提交
  const handleNameSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!nameInputMessageId || !nameInputValue.trim()) return;
    
    const newFavorite: FavoriteMessage = {
      id: `fav-${Date.now()}`,
      name: nameInputValue.trim(),
      messageId: nameInputMessageId
    };
    
    setFavorites(prev => {
      const newFavorites = [...prev, newFavorite];
      // 更新原始数据中的收藏
      updateOriginalDataFavorites(newFavorites);
      return newFavorites;
    });
    setNameInputMessageId(null);
    setNameInputValue('');
    
    addLog(`已将消息 ${nameInputMessageId} 添加到收藏，名称: "${newFavorite.name}"`);
  };

  // 跳转到收藏的消息
  const scrollToFavorite = (favoriteId: string) => {
    const favorite = favorites.find(f => f.id === favoriteId);
    if (!favorite) return;
    
    // 查找收藏的消息
    const favoriteMessageId = favorite.messageId;
    if (!messages[favoriteMessageId]) {
      addLog(`收藏的消息"${favorite.name}"不存在或已被删除`);
      return;
    }
    
    // 查找消息在当前路径中的位置
    const messageIndex = currentPath.indexOf(favoriteMessageId);
    
    if (messageIndex >= 0) {
      // 如果消息已经在当前路径中，直接滚动到该位置
      const messageElement = document.getElementById(`message-${favoriteMessageId}`);
      if (messageElement) {
        messageElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // 高亮显示该消息
        messageElement.classList.add('highlight-message');
        setTimeout(() => {
          messageElement.classList.remove('highlight-message');
        }, 2000);
      }
    } else {
      // 如果消息不在当前路径中，构建新路径
      addLog(`收藏的消息"${favorite.name}"不在当前路径中，正在切换到包含此消息的分支...`);
      
      // 构建包含目标消息的新路径
      const newPath = buildPathToMessage(favoriteMessageId);
      
      if (newPath.length > 0) {
        // 设置新路径
        setCurrentPath(newPath);
        addLog(`已切换到包含消息"${favorite.name}"的分支，路径长度: ${newPath.length}`);
        
        // 等待组件渲染后滚动到目标消息
        setTimeout(() => {
          const messageElement = document.getElementById(`message-${favoriteMessageId}`);
          if (messageElement) {
            messageElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
            messageElement.classList.add('highlight-message');
            setTimeout(() => {
              messageElement.classList.remove('highlight-message');
            }, 2000);
          }
        }, 100);
      } else {
        addLog(`无法构建到消息"${favorite.name}"的路径`);
      }
    }
  };
  
  // 构建到特定消息的路径
  const buildPathToMessage = (targetMessageId: string): string[] => {
    // 从目标消息开始，向上回溯构建到根节点的路径
    const ancestors: string[] = [];
    let currentId = targetMessageId;
    
    // 向上追溯所有祖先节点，直到根节点
    while (currentId) {
      ancestors.unshift(currentId); // 在路径前端插入当前节点
      const parent = messages[currentId]?.parent;
      if (!parent) break; // 已到达根节点
      currentId = parent;
    }
    
    // 从根节点向下，按照最新策略向下构建路径
    const path = [...ancestors]; // 先包含所有祖先节点
    
    // 如果目标消息有子节点，继续往下构建路径
    const buildDownwards = (nodeId: string) => {
      const node = messages[nodeId];
      if (!node || node.children.length === 0) return;
      
      // 选择最新的子节点继续构建路径
      if (node.children.length === 1) {
        const childId = node.children[0];
        path.push(childId);
        buildDownwards(childId);
      } else {
        // 多个子节点时，选择时间最靠后的那个
        let latestChildId = node.children[0];
        let latestTime = 0;
        
        for (const childId of node.children) {
          const originalNode = (window as any).originalMapping?.[childId];
          const createTime = originalNode?.message?.create_time || 0;
          
          if (createTime > latestTime) {
            latestTime = createTime;
            latestChildId = childId;
          }
        }
        
        path.push(latestChildId);
        buildDownwards(latestChildId);
      }
    };
    
    // 从目标消息开始往下构建路径
    buildDownwards(targetMessageId);
    
    return path;
  };

  // 取消收藏
  const removeFavorite = (favoriteId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    
    setFavorites(prev => {
      const newFavorites = prev.filter(f => f.id !== favoriteId);
      // 更新原始数据中的收藏
      updateOriginalDataFavorites(newFavorites);
      return newFavorites;
    });
    addLog(`已移除收藏 ${favoriteId}`);
  };

  // 修改保存对话树函数，使用文件选择器
  const saveConversation = async () => {
    if (!originalData) {
      addLog('没有可保存的对话数据');
      return;
    }
    
    try {
      // 确保收藏信息已更新
      originalData.favorites = favorites;
      
      // 将对象转换为 JSON 字符串
      const jsonString = JSON.stringify(originalData, null, 2);
      
      // 检查是否支持 showSaveFilePicker API
      if ('showSaveFilePicker' in window) {
        try {
          // 使用文件系统访问API
          const fileHandle = await (window as any).showSaveFilePicker({
            suggestedName: originalFileName || 'chatgpt_conversation.json',
            types: [{
              description: 'JSON Files',
              accept: { 'application/json': ['.json'] },
            }],
          });
          
          // 创建可写流
          const writable = await fileHandle.createWritable();
          // 写入内容
          await writable.write(jsonString);
          // 关闭流
          await writable.close();
          
          addLog(`已保存对话树，包含 ${favorites.length} 个收藏`);
        } catch (err) {
          if ((err as any).name === 'AbortError') {
            // 用户取消了保存操作
            addLog('保存操作已取消');
          } else {
            throw err;
          }
        }
      } else {
        // 降级方案：使用传统的下载方法
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        
        // 使用原始文件名
        const filename = originalFileName || `chatgpt_conversation.json`;
        
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        
        // 清理
        setTimeout(() => {
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }, 0);
        
        addLog(`已下载对话树到 ${filename}，包含 ${favorites.length} 个收藏`);
        addLog('注意：由于浏览器限制，文件已下载到您的下载文件夹，需要手动替换原文件。');
      }
    } catch (error) {
      console.error('保存对话树失败:', error);
      addLog(`保存失败: ${error}`);
    }
  };

  // 在组件初始化时添加这段代码
  useEffect(() => {
    // 当消息首次加载完成后，保存初始状态
    if (Object.keys(messages).length > 0 && history.length === 0) {
      const initialState: HistoryState = {
        deletedNodesArray: [],
        deletedFavorites: []
      };
      setHistory([initialState]);
      setHistoryIndex(0);
    }
  }, [messages, history.length]);

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
        <div className="flex items-center space-x-2">
          {Object.keys(messages).length > 0 && (
            <>
              <button 
                onClick={navigateToLatest} 
                className="import-btn bg-blue-500"
                title="导航到时间最新的分支"
              >
                最新分支
              </button>
              <button 
                onClick={navigateToLongest} 
                className="import-btn bg-green-500"
                title="导航到层数最多的分支"
              >
                最长分支
              </button>
              <button 
                onClick={saveConversation} 
                className="import-btn bg-purple-500"
                title="保存对话树（可选择保存位置）"
              >
                保存
              </button>
              <button 
                onClick={undo} 
                className={`import-btn ${historyIndex > 0 ? 'bg-orange-500' : 'bg-gray-400'}`}
                disabled={historyIndex <= 0}
                title="撤销上一次删除操作"
              >
                撤销删除
              </button>
            </>
          )}
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
      
      {/* 收藏导航区域 */}
      {favorites.length > 0 && (
        <div className="favorites-bar">
          <div className="favorites-title">收藏消息:</div>
          <div className="favorites-list">
            {favorites.map(favorite => (
              <div 
                key={favorite.id} 
                className="favorite-item"
                onClick={() => scrollToFavorite(favorite.id)}
                title={`跳转到: ${favorite.name}`}
              >
                <span className="favorite-star">★</span>
                <span className="favorite-name">{favorite.name}</span>
                <button 
                  className="remove-favorite"
                  onClick={(e) => removeFavorite(favorite.id, e)}
                  title="移除收藏"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

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

      {/* 调试日志区域 */}
      {isDebugMode && debugLogs.length > 0 && (
        <div className="debug-logs">
          <div className="debug-header">
            <h3>调试日志</h3>
            <button 
              onClick={() => setDebugLogs([])} 
              className="clear-logs-btn"
              title="清除日志"
            >
              清除
            </button>
          </div>
          <div className="log-content">
            {debugLogs.map((log, index) => (
              <div key={index} className="log-line">{log}</div>
            ))}
          </div>
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
            if (message.hidden || deletedNodes.has(messageId)) return null;

            // 特别处理：跳过根节点和系统消息
            if (index < 2 && (message.role === 'system' || message.role === 'unknown') && !message.content.trim()) {
              return null;
            }
            
            const isUser = message.role === 'user';
            const parent = message.parent;
            const hasSiblings = parent && messages[parent]?.children.filter(childId => !messages[childId].hidden && !deletedNodes.has(childId)).length > 1;
            const isFavorite = favorites.some(f => f.messageId === messageId);
            
            return (
              <div key={messageId} id={`message-${messageId}`} className="message-group">
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
                    <div className="message-actions">
                      {hasSiblings && (
                        <div className="branch-buttons">
                          {messages[parent].children
                            .filter(childId => !messages[childId].hidden && !deletedNodes.has(childId))
                            .map((siblingId, siblingIndex) => {
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
                      
                      {/* 收藏按钮和命名输入框 */}
                      <div className="favorite-container">
                        <button 
                          className={`favorite-button ${isFavorite ? 'favorited' : ''}`}
                          onClick={() => handleFavoriteClick(messageId)}
                          title={isFavorite ? "已收藏" : "添加到收藏"}
                        >
                          {isFavorite ? '★' : '☆'}
                        </button>
                        
                        {/* 命名输入框 - 内联显示在按钮旁边 */}
                        {nameInputMessageId === messageId && (
                          <form className="inline-name-form" onSubmit={handleNameSubmit}>
                            <input
                              ref={nameInputRef}
                              type="text"
                              value={nameInputValue}
                              onChange={(e) => setNameInputValue(e.target.value)}
                              placeholder="收藏名称..."
                              className="inline-name-input"
                              autoFocus
                            />
                            <button type="submit" className="inline-submit-name">✓</button>
                            <button 
                              type="button" 
                              className="inline-cancel-name"
                              onClick={() => setNameInputMessageId(null)}
                            >
                              ✕
                            </button>
                          </form>
                        )}
                        
                        {/* 删除按钮 */}
                        <button 
                          className="delete-button"
                          onClick={() => deleteNode(messageId)}
                          title="删除此消息及其所有子消息"
                        >
                          🗑️
                        </button>
                      </div>
                    </div>
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