import { createContext, createElement, useContext, useMemo, type ReactElement, type ReactNode } from 'react';
import type { ServiceIdentifier } from './base.js';
import type { IInstantiationService } from './container.js';

const ContainerContext = createContext<IInstantiationService | null>(null);

export function InstantiationContext(props: { instantiationService: IInstantiationService; children?: ReactNode }): ReactElement {
  return createElement(ContainerContext.Provider, { value: props.instantiationService }, props.children);
}

export function useService<T>(identifier: ServiceIdentifier<T>): T {
  const container = useContext(ContainerContext);
  if (!container) {
    throw new Error('useService must be called below an InstantiationContext provider.');
  }
  return useMemo(() => container.invokeFunction((accessor) => accessor.get(identifier)), [container, identifier]);
}
