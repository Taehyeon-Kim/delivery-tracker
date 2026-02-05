/**
 * CUpost carrier test script
 * Run: npx ts-node packages/core/src/carriers/kr.cupost/test.ts
 */

import { CUpost } from "./index";
import { CarrierUpstreamFetcher } from "../../carrier-upstream-fetcher/CarrierUpstreamFetcher";

async function main() {
  const trackingNumber = process.argv[2] || "460305642521";
  
  console.log(`\n🔍 Testing kr.cupost with tracking number: ${trackingNumber}\n`);
  
  const carrier = new CUpost();
  
  // Initialize carrier with upstream fetcher
  const upstreamFetcher = new CarrierUpstreamFetcher({ carrier });
  await carrier.init({ upstreamFetcher, config: {} });
  
  try {
    const result = await carrier.track({ trackingNumber });
    
    console.log("=== 📦 Tracking Result ===\n");
    console.log(`보내는 분: ${result.sender?.name || "N/A"}`);
    console.log(`받는 분: ${result.recipient?.name || "N/A"}`);
    console.log(`\n=== 📋 Events (${result.events.length}) ===\n`);
    
    for (const event of result.events) {
      const time = event.time?.toFormat("yyyy-MM-dd HH:mm:ss") || "N/A";
      const status = event.status.name;
      const statusCode = event.status.code;
      const location = event.location?.name || "N/A";
      
      console.log(`[${time}] ${status} (${statusCode})`);
      console.log(`  📍 ${location}`);
      console.log("");
    }
    
    console.log("✅ Test passed!");
    
  } catch (error) {
    console.error("❌ Test failed:", error);
    process.exit(1);
  }
}

main();
