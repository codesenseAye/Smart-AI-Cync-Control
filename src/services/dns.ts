import { config } from "../config.js";

const CYNC_DOMAINS = [
  "cm.gelighting.com",
  "cm-sec.gelighting.com",
  "cm-ge.xlink.cn",
];

interface DnsResult {
  ok: boolean;
  detail: string;
}

interface DnsStatus {
  enabled: boolean;
  entries: string[];
}

class DnsService {
  private token: string | null = null;

  private get baseUrl() {
    return config.technitium.url;
  }
  private get username() {
    return config.technitium.username;
  }
  private get password() {
    return config.technitium.password;
  }

  /**
   * Authenticate with Technitium and get a session token.
   */
  private async login(): Promise<void> {
    const body = new URLSearchParams({ user: this.username, pass: this.password });
    const res = await fetch(`${this.baseUrl}/api/user/login`, {
      method: "POST",
      body,
    });
    const data = (await res.json()) as { status: string; token?: string; errorMessage?: string };

    if (data.status !== "ok" || !data.token) {
      throw new Error(data.errorMessage || "Failed to authenticate with Technitium DNS");
    }

    this.token = data.token;
  }

  /**
   * Ensure we have a valid token, re-authenticating if needed.
   */
  private async ensureToken(): Promise<string> {
    if (!this.token) {
      await this.login();
    }
    return this.token!;
  }

  /**
   * Make an API call to Technitium with auto-retry on auth failure.
   */
  private async api(path: string, params: Record<string, string> = {}): Promise<any> {
    const token = await this.ensureToken();
    const query = new URLSearchParams({ token, ...params }).toString();
    const url = `${this.baseUrl}${path}?${query}`;

    let res = await fetch(url);
    let data = await res.json();

    // If token expired, re-login and retry once
    if (data.status === "error" && data.errorMessage?.includes("Invalid token")) {
      this.token = null;
      const newToken = await this.ensureToken();
      const retryQuery = new URLSearchParams({ token: newToken, ...params }).toString();
      res = await fetch(`${this.baseUrl}${path}?${retryQuery}`);
      data = await res.json();
    }

    return data;
  }

  /**
   * Enable DNS override: creates primary zones in Technitium for Cync domains
   * pointing to the target IP. Works network-wide for all devices using this DNS.
   */
  async enable(targetIp: string): Promise<DnsResult> {
    if (!targetIp || !/^\d{1,3}(\.\d{1,3}){3}$/.test(targetIp)) {
      return { ok: false, detail: `Invalid IP address: "${targetIp}"` };
    }

    try {
      for (const domain of CYNC_DOMAINS) {
        // Create a primary zone for the domain
        await this.api("/api/zones/create", {
          zone: domain,
          type: "Primary",
        });

        // Add an A record pointing to the target IP
        await this.api("/api/zones/records/add", {
          zone: domain,
          domain,
          type: "A",
          ipAddress: targetIp,
          overwrite: "true",
          ttl: "60",
        });
      }

      console.log(
        `[dns] Enabled cync-lan DNS override via Technitium: ${CYNC_DOMAINS.join(", ")} -> ${targetIp}`
      );

      return {
        ok: true,
        detail: `DNS override enabled. ${CYNC_DOMAINS.length} domains now resolve to ${targetIp} network-wide via Technitium DNS.`,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, detail: `Failed to configure Technitium DNS: ${msg}` };
    }
  }

  /**
   * Disable DNS override: deletes the Cync domain zones from Technitium.
   */
  async disable(): Promise<DnsResult> {
    try {
      let anyDeleted = false;

      for (const domain of CYNC_DOMAINS) {
        const result = await this.api("/api/zones/delete", { zone: domain });
        if (result.status === "ok") {
          anyDeleted = true;
        }
      }

      if (!anyDeleted) {
        return {
          ok: true,
          detail: "DNS override was not active. No changes made.",
        };
      }

      console.log("[dns] Disabled cync-lan DNS override via Technitium");
      return {
        ok: true,
        detail:
          "DNS override disabled. Cync devices will connect to the cloud once DNS caches expire.",
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, detail: `Failed to configure Technitium DNS: ${msg}` };
    }
  }

  /**
   * Check current DNS override status by looking for Cync zones in Technitium.
   */
  async status(): Promise<DnsStatus> {
    try {
      const entries: string[] = [];

      for (const domain of CYNC_DOMAINS) {
        try {
          const result = await this.api("/api/zones/records/get", {
            domain,
            zone: domain,
          });

          if (result.status === "ok" && result.response?.records) {
            const aRecords = result.response.records.filter(
              (r: any) => r.type === "A"
            );
            for (const record of aRecords) {
              entries.push(`${record.rData.ipAddress} ${domain}`);
            }
          }
        } catch {
          // Zone doesn't exist, skip
        }
      }

      return {
        enabled: entries.length > 0,
        entries,
      };
    } catch {
      return { enabled: false, entries: [] };
    }
  }
}

export const dnsService = new DnsService();
