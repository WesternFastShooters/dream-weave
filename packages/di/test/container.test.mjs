import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createDecorator,
  getService,
  InstantiationService,
  ServiceCollection,
  ServiceOwnership,
  ServiceRegistry,
  SyncDescriptor,
} from '../dist/index.js';

const IClock = createDecorator('test-clock');
const IMessageService = createDecorator('test-message-service');

class Clock {
  now() {
    return 'now';
  }
}

class MessageService {
  constructor(clock) {
    this.clock = clock;
  }

  message() {
    return `message:${this.clock.now()}`;
  }
}
IClock(MessageService, undefined, 0);

test('creates and caches constructor dependencies by token', () => {
  const registry = new ServiceRegistry();
  registry.register(IClock, Clock);
  registry.register(IMessageService, MessageService);
  const container = new InstantiationService(registry.makeCollection());

  const first = getService(container, IMessageService);
  const second = getService(container, IMessageService);

  assert.equal(first.message(), 'message:now');
  assert.equal(first, second);
});

test('a child container overrides services and disposes only services it owns', () => {
  let parentDisposed = 0;
  let childDisposed = 0;
  const IResource = createDecorator('test-resource');
  const parentResource = { dispose: () => parentDisposed++ };
  const childResource = { dispose: () => childDisposed++ };

  const rootServices = new ServiceCollection();
  rootServices.set(IResource, parentResource);
  const root = new InstantiationService(rootServices);
  const childServices = new ServiceCollection();
  childServices.set(IResource, childResource, ServiceOwnership.Owned);
  const child = root.createChild(childServices);

  assert.equal(getService(child, IResource), childResource);
  child.dispose();
  assert.equal(childDisposed, 1);
  assert.equal(parentDisposed, 0);

  root.dispose();
  assert.equal(parentDisposed, 1);
});

test('delayed services are not constructed until first use', () => {
  let creations = 0;
  const ILazy = createDecorator('test-lazy');
  class LazyService {
    constructor() {
      creations++;
    }
    value() {
      return 42;
    }
  }
  const registry = new ServiceRegistry();
  registry.register(ILazy, new SyncDescriptor(LazyService, [], true));
  const container = new InstantiationService(registry.makeCollection());

  const service = getService(container, ILazy);
  assert.equal(creations, 0);
  assert.equal(service.value(), 42);
  assert.equal(creations, 1);
});

test('keeps descriptor static arguments before injected services', () => {
  const IProjectClock = createDecorator('test-project-clock');
  const IProjectService = createDecorator('test-project-service');
  class ProjectClock {
    label() {
      return 'clock';
    }
  }
  class ProjectService {
    constructor(projectId, clock) {
      this.projectId = projectId;
      this.clock = clock;
    }
  }
  IProjectClock(ProjectService, undefined, 1);

  const registry = new ServiceRegistry();
  registry.register(IProjectClock, ProjectClock);
  registry.register(IProjectService, new SyncDescriptor(ProjectService, ['project-42']));
  const container = new InstantiationService(registry.makeCollection());
  const project = getService(container, IProjectService);

  assert.equal(project.projectId, 'project-42');
  assert.equal(project.clock.label(), 'clock');
});
