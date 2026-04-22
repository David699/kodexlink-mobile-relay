import type { Logger } from "@kodexlink/shared";

export class SessionMapper {
  public constructor(private readonly logger: Logger) {}

  public mapMessage(type: string): string {
    this.logger.debug("mapping session message", { type });
    return type;
  }
}

