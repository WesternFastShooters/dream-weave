import { createContext, useContext } from 'react';
import type { NodeRuntimeServices } from './types.js';
const NodeRuntimeContext = createContext<NodeRuntimeServices>({});
export const CreativeNodeRuntimeProvider = NodeRuntimeContext.Provider;
export function useCreativeNodeRuntime(): NodeRuntimeServices { return useContext(NodeRuntimeContext); }
