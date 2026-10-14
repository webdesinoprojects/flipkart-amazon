import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    ["/", 1],
    ["/flipkart-label-crop", 0.9],
    ["/amazon-label-without-invoice", 0.9],
    ["/meesho-label-crop", 0.9],
    ["/privacy", 0.4],
    ["/terms", 0.4],
    ["/refund-policy", 0.4],
    ["/contact", 0.5],
  ].map(([path, priority]) => ({
    url: absoluteUrl(String(path)),
    changeFrequency: "weekly" as const,
    priority: Number(priority),
  }));
}
