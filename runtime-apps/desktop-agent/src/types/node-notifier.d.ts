declare module "node-notifier" {
  interface NotifyOptions {
    title: string;
    message: string;
    subtitle?: string;
    wait?: boolean;
  }

  interface NodeNotifier {
    notify(options: NotifyOptions): void;
  }

  const notifier: NodeNotifier;
  export default notifier;
}
