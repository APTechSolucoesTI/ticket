import type { ImgHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type BrandLogoProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  variant?: "auto" | "light" | "dark";
};

const logoByVariant = {
  light: "/apticket-icon-light.png",
  dark: "/apticket-icon-dark.png",
} as const;

export function BrandLogo({
  variant = "auto",
  className,
  alt = "APTicket",
  ...props
}: BrandLogoProps) {
  const imageClassName = cn("shrink-0 object-contain", className);

  if (variant !== "auto") {
    return (
      <img
        src={logoByVariant[variant]}
        alt={alt}
        className={imageClassName}
        draggable={false}
        {...props}
      />
    );
  }

  return (
    <>
      <img
        src={logoByVariant.light}
        alt={alt}
        className={cn(imageClassName, "dark:hidden")}
        draggable={false}
        {...props}
      />
      <img
        src={logoByVariant.dark}
        alt={alt}
        className={cn(imageClassName, "hidden dark:block")}
        draggable={false}
        {...props}
      />
    </>
  );
}
