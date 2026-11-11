import { demoAcquisitionSources } from "./demo-acquisition.js";
import { validateQrForeground } from "./branded-qr-model.js";

// Generated from the enrollment renderer with a separate, public demonstration payload.
// The constant contains no customer data and makes no network requests.
const configuration = {
  "ok": true,
  "business": {
    "id": "11111111-1111-4111-8111-111111111111",
    "name": "Café Jacaranda · demo",
    "slug": "cafe-jacaranda-demo"
  },
  "registration_url": "https://puntosfieles.com/demostracion#marca",
  "branding": {
    "primary_color": "#302820",
    "accent_color": "#F0DDA5",
    "logo_included": true,
    "logo_note": "Logotipo de ejemplo para un negocio ficticio. Puedes cambiarlo por un archivo en esta pestaña."
  },
  "defaults": {
    "foreground": "#302820",
    "logo_position": "center"
  },
  "capabilities": {
    "error_correction": "H",
    "quiet_zone_modules": 4,
    "minimum_contrast": 4.5,
    "logo_positions": ["center", "header", "none"]
  }
};
const artwork = "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"480\" height=\"680\" viewBox=\"0 0 480 680\" role=\"img\" aria-labelledby=\"qr-title qr-description\">\n<title id=\"qr-title\">QR de inscripción de Café Jacaranda · demo</title>\n<desc id=\"qr-description\">Escanea para registrarte en el programa de Café Jacaranda · demo.</desc>\n<rect width=\"480\" height=\"680\" fill=\"#FFFFFF\"/>\n<rect x=\"18\" y=\"18\" width=\"444\" height=\"644\" rx=\"14\" fill=\"#FFFFFF\" stroke=\"#302820\"/>\n<path d=\"M40 32H440\" stroke=\"#F0DDA5\" stroke-width=\"8\"/>\n\n<text x=\"240\" y=\"106\" text-anchor=\"middle\" fill=\"#302820\" font-family=\"Bricolage Grotesque, sans-serif\" font-size=\"28\" font-weight=\"700\">Café Jacaranda · demo</text>\n<text x=\"240\" y=\"139\" text-anchor=\"middle\" fill=\"#302820\" font-family=\"Inter, sans-serif\" font-size=\"16\">Tu próxima visita empieza aquí</text>\n<svg x=\"50\" y=\"178\" xmlns=\"http://www.w3.org/2000/svg\" width=\"380\" height=\"380\" viewBox=\"0 0 45 45\" shape-rendering=\"crispEdges\"><path fill=\"#FFFFFF\" d=\"M0 0h45v45H0z\"/><path stroke=\"#302820\" d=\"M4 4.5h7m1 0h1m2 0h4m2 0h4m1 0h1m1 0h2m2 0h1m1 0h7M4 5.5h1m5 0h1m1 0h5m3 0h2m2 0h3m1 0h4m2 0h1m5 0h1M4 6.5h1m1 0h3m1 0h1m1 0h1m6 0h2m1 0h4m2 0h1m1 0h3m1 0h1m1 0h3m1 0h1M4 7.5h1m1 0h3m1 0h1m2 0h2m2 0h3m6 0h2m1 0h2m3 0h1m1 0h3m1 0h1M4 8.5h1m1 0h3m1 0h1m3 0h2m1 0h3m2 0h4m2 0h1m1 0h1m3 0h1m1 0h3m1 0h1M4 9.5h1m5 0h1m1 0h1m2 0h1m4 0h1m1 0h4m2 0h2m1 0h2m1 0h1m5 0h1M4 10.5h7m1 0h1m1 0h1m1 0h1m1 0h1m1 0h1m1 0h1m1 0h1m1 0h1m1 0h1m1 0h1m1 0h1m1 0h7M12 11.5h3m2 0h1m1 0h1m5 0h3m4 0h1M6 12.5h3m1 0h1m1 0h2m2 0h9m1 0h1m2 0h2m1 0h4m2 0h3M5 13.5h1m2 0h2m1 0h1m1 0h6m2 0h1m1 0h2m3 0h2m2 0h1m4 0h1M4 14.5h2m4 0h1m2 0h2m2 0h2m2 0h1m2 0h1m1 0h2m1 0h4m1 0h1m1 0h1m1 0h3M4 15.5h2m2 0h2m1 0h1m2 0h4m1 0h1m1 0h1m3 0h1m1 0h2m1 0h2m2 0h3m2 0h1M4 16.5h1m1 0h1m1 0h3m1 0h2m1 0h1m1 0h1m1 0h1m1 0h1m2 0h1m1 0h1m1 0h4m1 0h2m1 0h3m1 0h1M4 17.5h1m1 0h4m1 0h1m2 0h1m2 0h3m2 0h2m3 0h1m2 0h1m1 0h2m1 0h1m1 0h3M5 18.5h1m4 0h2m5 0h2m2 0h1m1 0h1m1 0h1m1 0h2m1 0h8m1 0h2M8 19.5h2m1 0h5m2 0h2m2 0h1m1 0h2m1 0h1m2 0h3m2 0h2M4 20.5h1m1 0h1m1 0h1m1 0h1m2 0h3m2 0h3m3 0h1m1 0h1m1 0h3m2 0h2m1 0h1m1 0h2M4 21.5h2m6 0h1m1 0h3m1 0h1m2 0h1m1 0h1m2 0h1m3 0h1m1 0h1m2 0h1M4 22.5h5m1 0h3m3 0h4m2 0h6m1 0h1m1 0h7m1 0h2M4 23.5h4m1 0h1m2 0h2m2 0h1m3 0h1m1 0h2m2 0h1m1 0h1m1 0h3m1 0h1m4 0h1M4 24.5h1m1 0h1m1 0h5m2 0h4m3 0h1m2 0h7m1 0h6M5 25.5h2m1 0h2m1 0h1m1 0h1m6 0h2m1 0h2m2 0h1m2 0h1m4 0h1m2 0h1M5 26.5h1m1 0h4m1 0h2m1 0h4m1 0h2m1 0h5m1 0h1m1 0h1m2 0h1m3 0h3M6 27.5h1m1 0h1m3 0h6m1 0h2m1 0h5m1 0h1m1 0h1m2 0h1m1 0h1m3 0h2M4 28.5h1m2 0h8m1 0h2m1 0h3m2 0h2m2 0h3m2 0h2m1 0h3m1 0h1M4 29.5h1m4 0h1m1 0h1m2 0h1m1 0h2m2 0h3m1 0h1m7 0h1m2 0h1m1 0h2M4 30.5h1m2 0h2m1 0h1m1 0h2m1 0h1m1 0h1m2 0h1m6 0h2m2 0h2m1 0h3m2 0h2M4 31.5h1m2 0h3m8 0h1m1 0h1m4 0h3m3 0h3m1 0h2M4 32.5h1m1 0h1m2 0h4m1 0h1m4 0h2m2 0h1m1 0h6m1 0h8M12 33.5h1m1 0h1m2 0h3m1 0h2m1 0h4m2 0h3m3 0h1M4 34.5h7m3 0h3m2 0h1m4 0h3m1 0h2m2 0h1m1 0h1m1 0h2m1 0h2M4 35.5h1m5 0h1m3 0h1m2 0h1m3 0h3m2 0h3m1 0h1m1 0h1m3 0h1m2 0h2M4 36.5h1m1 0h3m1 0h1m1 0h1m1 0h1m1 0h2m2 0h1m2 0h1m1 0h1m2 0h2m1 0h6m1 0h3M4 37.5h1m1 0h3m1 0h1m1 0h2m4 0h3m1 0h2m4 0h1m5 0h1m1 0h1m1 0h1M4 38.5h1m1 0h3m1 0h1m1 0h2m1 0h2m2 0h1m1 0h1m3 0h2m3 0h1m2 0h1m4 0h1m1 0h1M4 39.5h1m5 0h1m4 0h1m3 0h1m1 0h1m1 0h1m1 0h1m2 0h1m2 0h2m2 0h1m4 0h1M4 40.5h7m5 0h1m4 0h2m1 0h3m2 0h2m2 0h4m1 0h3\"/></svg>\n\n<text x=\"240\" y=\"595\" text-anchor=\"middle\" fill=\"#302820\" font-family=\"Bricolage Grotesque, sans-serif\" font-size=\"24\" font-weight=\"700\">Demostración</text>\n<text x=\"240\" y=\"625\" text-anchor=\"middle\" fill=\"#302820\" font-family=\"Inter, sans-serif\" font-size=\"15\">Este ejemplo no registra clientes</text>\n</svg>";

const demoLogo = "data:image/png;base64,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";
export function demoBrandedQrConfiguration() { return { ...structuredClone(configuration), sources: demoAcquisitionSources() }; }
export function demoBrandedQrSvg(foreground, { logo_position = 'center', logo_data_url } = {}) {
  const error = validateQrForeground(foreground);
  if (error) throw new Error(error);
  if (!['center','header','none'].includes(logo_position)) throw new Error('Ubicación no válida.');
  const logo = logo_data_url === undefined ? demoLogo : logo_data_url;
  if (logo !== null && (typeof logo !== 'string' || logo.length > 180000 || !/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(logo))) throw new Error('Logotipo no válido.');
  let svg = artwork.replaceAll('#302820', foreground.toUpperCase());
  if (!logo || logo_position === 'none') return svg;
  if (logo_position === 'header') return svg.replace('<text x="240" y="106"', '<image x="204" y="48" width="72" height="72" preserveAspectRatio="xMidYMid meet" href="'+logo+'"/><text x="240" y="154"').replace(/<text x="240" y="139"[^>]*>[^<]*<\/text>/, '');
  const dimension = Number(svg.match(/<svg x="50" y="178"[^>]*viewBox="0 0 (\d+) /)[1]);
  const box = (dimension-8)*0.18, x=(dimension-box)/2, pad=box*0.1;
  const mark='<g data-qr-logo="center" shape-rendering="auto"><rect x="'+x+'" y="'+x+'" width="'+box+'" height="'+box+'" fill="#FFFFFF"/><image x="'+(x+pad)+'" y="'+(x+pad)+'" width="'+(box-2*pad)+'" height="'+(box-2*pad)+'" preserveAspectRatio="xMidYMid meet" href="'+logo+'"/></g>';
  return svg.replace('</svg>',mark+'</svg>');
}
