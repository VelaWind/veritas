import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Veritas — An observatory for knowledge",
    short_name: "Veritas",
    description:
      "A living map of what humanity knows, suspects, and cannot yet answer.",
    start_url: "/",
    display: "standalone",
    background_color: "#060A12",
    theme_color: "#060A12",
    icons: [{ src: "/icon", sizes: "512x512", type: "image/png" }],
  };
}
