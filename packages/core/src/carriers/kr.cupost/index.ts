import * as cheerio from "cheerio";
import { DateTime } from "luxon";
import {
  Carrier,
  type TrackEvent,
  TrackEventStatusCode,
  type TrackInfo,
  type CarrierTrackInput,
} from "../../core";
import { rootLogger } from "../../logger";
import { NotFoundError } from "../../core/errors";
import { type Logger } from "winston";
import { type CarrierUpstreamFetcher } from "../../carrier-upstream-fetcher/CarrierUpstreamFetcher";

const carrierLogger = rootLogger.child({
  carrierId: "kr.cupost",
});

class CUpost extends Carrier {
  readonly carrierId = "kr.cupost";

  public async track(input: CarrierTrackInput): Promise<TrackInfo> {
    return await new CUpostTrackScraper(
      this.upstreamFetcher,
      input.trackingNumber
    ).track();
  }
}

class CUpostTrackScraper {
  private readonly logger: Logger;
  private readonly carrierSpecificDataPrefix = "kr.cupost";

  constructor(
    readonly upstreamFetcher: CarrierUpstreamFetcher,
    readonly trackingNumber: string
  ) {
    this.logger = carrierLogger.child({ trackingNumber });
  }

  public async track(): Promise<TrackInfo> {
    const response = await this.upstreamFetcher.fetch(
      "https://www.cupost.co.kr/postbox/delivery/allResult.cupost",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          invoice_no: this.trackingNumber,
          kind_type: "",
        }).toString(),
      }
    );

    const html = await response.text();
    this.logger.debug("response html", { html: html.substring(0, 1000) });

    const $ = cheerio.load(html);

    // Check if tracking info exists
    const errorMsg = $(".MsgError strong").text().trim();
    if (errorMsg || !$(".tracking-result").length) {
      throw new NotFoundError("운송장 정보를 찾을 수 없습니다.");
    }

    // Parse sender/receiver - find by label text
    let senderName = "";
    let receiverName = "";
    let goodsName = "";

    // Find receiver section (받는 분)
    $("span").each((_, el) => {
      const text = $(el).text().trim();
      if (text === "받는 분") {
        // Get the next .tracking-name sibling
        const container = $(el).parent().parent();
        receiverName = container.find(".tracking-name").first().text().trim();
        goodsName = container.find(".tracking-product span").text().trim();
      }
      if (text === "보내는 분") {
        const container = $(el).parent().parent();
        senderName = container.find(".tracking-name").first().text().trim();
      }
    });

    // Parse events
    const events: TrackEvent[] = [];
    $(".tracking-result-detail-item").each((_, el) => {
      const $el = $(el);
      
      // Parse date/time: "2026-01-16<br>10:57:48"
      const dateTimeRaw = $el.find(".tracking-result-detail-date").html() || "";
      const dateTimeParts = dateTimeRaw.replace(/<br\s*\/?>/gi, "T").replace(/\s+/g, "").trim();
      
      const statusName = $el.find(".tracking-result-detail-title").text().trim();
      const location = $el.find(".tracking-result-detail-name").text().trim();

      if (dateTimeParts && statusName) {
        events.push({
          status: {
            code: this.parseStatusCode(statusName),
            name: statusName,
            carrierSpecificData: new Map(),
          },
          time: this.parseTime(dateTimeParts),
          location: {
            countryCode: "KR",
            name: location,
            postalCode: null,
            carrierSpecificData: new Map(),
          },
          contact: null,
          description: `${statusName} - ${location}`,
          carrierSpecificData: new Map(),
        });
      }
    });

    // Reverse events (newest first in HTML, we want oldest first)
    events.reverse();

    return {
      sender: {
        name: senderName || null,
        location: null,
        phoneNumber: null,
        carrierSpecificData: new Map(),
      },
      recipient: {
        name: receiverName || null,
        location: null,
        phoneNumber: null,
        carrierSpecificData: new Map(),
      },
      events,
      carrierSpecificData: new Map([
        [`${this.carrierSpecificDataPrefix}/raw/goodsName`, goodsName],
      ]),
    };
  }

  private parseStatusCode(statusName: string): TrackEventStatusCode {
    // CU국내택배 status mapping
    const statusLower = statusName.toLowerCase();
    
    if (statusLower.includes("접수") || statusLower.includes("집하완료")) {
      return TrackEventStatusCode.AtPickup;
    }
    if (statusLower.includes("도착") && !statusLower.includes("배달")) {
      return TrackEventStatusCode.InTransit;
    }
    if (statusLower.includes("배달전") || statusLower.includes("배송출발")) {
      return TrackEventStatusCode.OutForDelivery;
    }
    if (statusLower.includes("배달완료") || statusLower.includes("인수완료")) {
      return TrackEventStatusCode.Delivered;
    }
    if (statusLower.includes("배송중") || statusLower.includes("이동중")) {
      return TrackEventStatusCode.InTransit;
    }

    this.logger.warn("Unknown status", { statusName });
    return TrackEventStatusCode.Unknown;
  }

  private parseTime(timeStr: string): DateTime | null {
    // Format: "2026-01-16T10:57:48"
    const result = DateTime.fromISO(timeStr, { zone: "Asia/Seoul" });
    if (!result.isValid) {
      this.logger.warn("time parse error", {
        inputTime: timeStr,
        invalidReason: result.invalidReason,
      });
      return null;
    }
    return result;
  }
}

export { CUpost };
