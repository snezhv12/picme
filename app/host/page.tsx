import type { Metadata } from "next";
import { isHost } from "@/lib/hostAuth";
import HostGame from "./HostGame";
import PinForm from "./PinForm";

export const metadata: Metadata = {
  title: "PicMe host",
  robots: { index: false },
};

// Nothing of the host screen is sent until the PIN cookie checks out
export default async function HostPage() {
  return (await isHost()) ? <HostGame /> : <PinForm />;
}
