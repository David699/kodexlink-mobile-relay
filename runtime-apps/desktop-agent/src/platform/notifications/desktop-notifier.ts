export interface DesktopNotificationInput {
  title: string;
  subtitle?: string;
  message: string;
}

export interface DesktopNotifier {
  notify(input: DesktopNotificationInput): Promise<void>;
}
