import { colorFor, initials } from "../lib/ui.js";

/** Avatar image with a colored-initials fallback when the user has no image. */
export function Avatar({
  name,
  image,
  size
}: {
  name: string;
  image?: string | null;
  size?: "lg";
}) {
  const cls = size === "lg" ? "lg" : "";
  if (image) return <img className={`avatar ${cls}`} src={image} alt="" />;
  return (
    <span className={`avatar-fallback ${cls}`} style={{ background: colorFor(name) }} aria-hidden>
      {initials(name)}
    </span>
  );
}
