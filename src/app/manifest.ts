import type { MetadataRoute } from "next";

/** Lets Folio be added to a phone's home screen and open full screen, like an app. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Folio — net worth tracker",
    short_name: "Folio",
    description: "Your stocks, funds and crypto across every broker, encrypted on your device.",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0a0b0d",
    theme_color: "#0a0b0d",
    categories: ["finance"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
