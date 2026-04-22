import type { DesktopNotifier, DesktopNotificationInput } from "./desktop-notifier.js";

export class NodeDesktopNotifier implements DesktopNotifier {
  public async notify(input: DesktopNotificationInput): Promise<void> {
    const module = (await import("node-notifier")) as {
      default?: {
        notify(options: {
          title: string;
          message: string;
          subtitle?: string;
          wait?: boolean;
        }): void;
      };
    };
    const notifier = module.default;

    if (!notifier) {
      throw new Error("node-notifier is unavailable");
    }

    await new Promise<void>((resolve, reject) => {
      try {
        notifier.notify(
          {
            title: input.title,
            message: input.message,
            subtitle: input.subtitle,
            wait: false
          }
        );
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  }
}
