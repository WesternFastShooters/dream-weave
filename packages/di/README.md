# @dream-weave/di

Canvas migration foundation: synchronous constructor injection with service tokens,
root/project child containers, lazy services, disposal, and an optional React adapter.

## Use it

```ts
const IProjectService = createDecorator<ProjectService>('project-service');
const ICanvasService = createDecorator<CanvasService>('canvas-service');

class CanvasService {
  constructor(@IProjectService private readonly projectService: ProjectService) {}
}

const registry = new ServiceRegistry();
registry.register(IProjectService, ProjectServiceImpl);
registry.register(ICanvasService, CanvasService);
const container = new InstantiationService(registry.makeCollection());
```

Create a child container for a project. Child services inherit root services and are
disposed when the project container is disposed.

```ts
const projectContainer = rootContainer.createChild(projectRegistry.makeCollection());
```

React components use `InstantiationContext` and `useService` from
`@dream-weave/di/react`. Product-specific services such as login, account, uploads,
or model access are supplied by the host application's root container; this package
does not implement them.
