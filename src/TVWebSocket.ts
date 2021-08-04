import { EventEmitter } from "events";
import randomstring from "randomstring";
import WebSocket from "ws";

import * as SIO from "./IOProtocol";
import { ISIOPacket } from "./SIOPacket";

export class TVWebSocket extends EventEmitter {
  private static ALL_QUOTE_FIELDS = [
    "ch",
    "chp",
    "current_session",
    "description",
    "local_description",
    "language",
    "exchange",
    "fractional",
    "is_tradable",
    "lp",
    "lp_time",
    "minmov",
    "minmove2",
    "original_name",
    "pricescale",
    "pro_name",
    "short_name",
    "type",
    "update_mode",
    "volume",
    "currency_code",
    "ask",
    "bid",
    "fundamentals",
    "high_price",
    "is_tradable",
    "low_price",
    "open_price",
    "prev_close_price",
    "rch",
    "rchp",
    "rtc",
    "rtc_time",
    "status",
    "basic_eps_net_income",
    "beta_1_year",
    "earnings_per_share_basic_ttm",
    "industry",
    "market_cap_basic",
    "price_earnings_ttm",
    "sector",
    "volume",
    "dividends_yield",
    "timezone"
  ];
  private static DEFAULT_TIMEOUT = 3000;

  private userToken = "unauthorized_user_token";
  private static generateSession() {
    return "qs_" + randomstring.generate({ length: 12, charset: "alphabetic" });
  }

  private ws: WebSocket | null = null;
  private quoteSession: string | null = null;
  private subscriptions: Set<string> = new Set();

  public async connect() {
    this.quoteSession = null;
    this.ws = new WebSocket("wss://data.tradingview.com/socket.io/websocket", {
      origin: "https://data.tradingview.com"
    });
    this.ws.on("message", (message: string) => this.wsOnMessage(message));
    await this.tvSessionReady();
  }

  public disconnect() {
    if (!this.ws) {
      return;
    }
    this.ws!.close();
    this.ws = null;
    this.quoteSession = null;
    this.subscriptions = new Set();
  }

  public async registerSymbol(symbol: string) {
    if (this.subscriptions.has(symbol)) {
      return;
    }
    this.subscriptions.add(symbol);
    this.addQuoteSymbol(symbol);
  }

  public async unregisterSymbol(symbol: string) {
    if (!this.subscriptions.delete(symbol)) {
      return;
    }
    this.removeQuoteSymbol(symbol);
  }

  public setAuthToken(token: string) {
      this.userToken = token;
  }

  private onPacket(packet: ISIOPacket) {
    if (packet.isKeepAlive) {
      // Handle protocol keepalive packets
      this.wsSendRaw("~h~" + (packet.data as string));
      return;
    }
    const data = packet.data;
    // Handle session packet
    if (data.session_id) {
      this.sendAuthToken(this.userToken);
      this.createQuoteSession();
      this.setQuoteFields(TVWebSocket.ALL_QUOTE_FIELDS);
      return;
    }
    if (
      data.m &&
      data.m === "qsd" &&
      typeof data.p === "object" &&
      data.p.length > 1 &&
      data.p[0] === this.quoteSession
    ) {
      const tickerData = data.p[1];
      this.emit("data", tickerData.n, tickerData.s, tickerData.v);
    }
  }

  private sendAuthToken(token: string) {
    this.wsSend("set_auth_token", [token]);
  }

  private createQuoteSession() {
    this.quoteSession = TVWebSocket.generateSession();
    this.wsSend("quote_create_session", [this.quoteSession]);
  }

  private setQuoteFields(fields: string[]) {
    this.wsSend("quote_set_fields", [this.quoteSession!, ...fields]);
  }

  private addQuoteSymbol(symbol: string) {
    this.ws!.send(
      SIO.createMessage("quote_add_symbols", [
        this.quoteSession!,
        symbol,
        { flags: ["force_permission"] }
      ])
    );
  }

  private removeQuoteSymbol(symbol: string) {
    this.ws!.send(
      SIO.createMessage("quote_remove_symbols", [this.quoteSession!, symbol])
    );
  }

  private wsOnMessage(data: string) {
    const packets = SIO.parseMessages(data);
    packets.forEach((packet: ISIOPacket) => this.onPacket(packet));
  }

  private wsSendRaw(message: string) {
    this.ws!.send(SIO.prependHeader(message));
  }

  private wsSend(func: string, args: any[]) {
    this.ws!.send(SIO.createMessage(func, args));
  }

  private async wsReady(timeout?: number) {
    if (!timeout) {
      timeout = TVWebSocket.DEFAULT_TIMEOUT;
    }
    if (this.ws!.readyState === WebSocket.OPEN) {
      return;
    }
    return new Promise((resolve, reject) => {
      let opened = false;
      const onOpen = () => {
        opened = true;
        resolve();
      };
      this.ws!.once("open", onOpen);
      setTimeout(() => {
        if (!opened) {
          this.ws!.removeListener("open", onOpen);
          reject();
        }
      }, timeout);
    });
  }

  private async tvSessionReady(timeout?: number) {
    if (!timeout) {
      timeout = TVWebSocket.DEFAULT_TIMEOUT;
    }
    await this.wsReady(timeout);

    return new Promise((resolve, reject) => {
      const interval = setInterval(() => {
        if (this.quoteSession !== null) {
          resolve();
          clearInterval(interval);
        }
      }, 100);
      setTimeout(() => {
        if (interval) {
          clearInterval(interval);
          reject();
        }
      }, timeout);
    });
  }
}
