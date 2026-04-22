import type { Logger } from "@kodexlink/shared";

import { DESKTOP_AGENT_PRODUCT_NAME } from "../product/brand.js";
import { createDesktopNotifier } from "../platform/notifications/desktop-notifier-factory.js";

export class ServiceStateNotifier {
  private readonly notifier = createDesktopNotifier();

  public constructor(private readonly logger: Logger) {}

  public async notifyOffline(detail: string): Promise<void> {
    await this.showNotification({
      title: DESKTOP_AGENT_PRODUCT_NAME,
      subtitle: "后台服务正在尝试恢复连接",
      message: detail
    });
  }

  public async notifyRecovered(detail: string): Promise<void> {
    await this.showNotification({
      title: DESKTOP_AGENT_PRODUCT_NAME,
      subtitle: "后台服务已恢复在线",
      message: detail
    });
  }

  private async showNotification(input: {
    title: string;
    subtitle: string;
    message: string;
  }): Promise<void> {
    try {
      await this.notifier.notify(input);
    } catch (error) {
      this.logger.warn("failed to show desktop-agent notification", {
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }
}
