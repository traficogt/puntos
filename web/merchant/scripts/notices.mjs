import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "..");
const lock = JSON.parse(
  await readFile(path.join(root, "package-lock.json"), "utf8"),
);
const sections = [
  "PuntosFieles merchant website — third-party notices\nRuntime dependencies are distributed under the following licenses.",
];
for (const [location, pkg] of Object.entries(lock.packages)) {
  if (!location || pkg.dev || pkg.optional) continue;
  const directory = path.join(root, location);
  const metadata = JSON.parse(
    await readFile(path.join(directory, "package.json"), "utf8"),
  );
  const files = (await readdir(directory)).filter((name) =>
    /^(license|licence|copying|notice)([-.]|$)/i.test(name),
  );
  if (!files.length && metadata.name !== "react-remove-scroll-bar")
    throw new Error(`Missing license notice for ${metadata.name}`);
  sections.push(
    `\n${metadata.name} ${metadata.version} (${metadata.license || pkg.license || "See notice"})\n${metadata.homepage || ""}`,
  );
  if (metadata.name === "react-remove-scroll-bar")
    sections.push(
      await readFile(
        path.join(root, "licenses/react-remove-scroll-bar-MIT.txt"),
        "utf8",
      ),
    );
  for (const file of files)
    sections.push(await readFile(path.join(directory, file), "utf8"));
}
await writeFile(
  path.resolve(root, "../../public/merchant/THIRD_PARTY_NOTICES.txt"),
  sections.join("\n\n"),
);
