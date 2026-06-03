"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { motion } from "framer-motion";

const Lottie = dynamic(() => import("lottie-react"), { ssr: false });

export default function Puppy() {
  const [data, setData] = useState<object | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/puppy.json")
      .then((r) => r.json())
      .then((j) => {
        if (active) setData(j);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="flex flex-col items-center">
      <motion.div
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 220, damping: 14, delay: 0.15 }}
        className="relative mb-2"
      >
        <span className="inline-block rounded-md3-lg border-2 border-inverse-surface bg-inverse-surface px-5 py-2 text-2xl font-extrabold tracking-tight text-inverse-on-surface shadow-md3-1">
          WOOF! Thank you!
        </span>
        <span className="absolute -bottom-2 left-10 h-4 w-4 rotate-45 border-b-2 border-r-2 border-inverse-surface bg-inverse-surface" />
      </motion.div>

      <div className="h-56 w-56">
        {data && <Lottie animationData={data} loop={false} autoplay />}
      </div>
    </div>
  );
}
