# Merchant experience: research and decisions

PF needs owners to understand performance and launch a useful program without becoming loyalty specialists. This review considered ten loyalty platforms and fifteen UI, charting and BI options. The work ships only to the website; native releases remain independent.

## What the loyalty platforms do well

| Platform | Relevant practice | PF application in this release |
| --- | --- | --- |
| [Loopy Loyalty](https://loopyloyalty.com/features/web-app/) | Guided card setup and QR distribution | Launch guide with actual business enrollment link and downloadable QR |
| [Devotio](https://devotiorewards.com/) | Configuration, staff training and launch as a process | Explicit staff test steps before customer rollout |
| [Loyverse](https://help.loyverse.com/help/how-customer-loyalty-program) | Simple earning rules visible at checkout | Current earning rule shown in the launch guide; scanner and POS setup links |
| [Square](https://squareup.com/help/us/en/article/6467-view-your-square-loyalty-metrics) | Operational metrics owners can inspect | Period/branch filters, repeat purchases, actual canjes, chart and data table |
| [Toast](https://pos.toasttab.com/products/loyalty) | Checkout integration and clear loyalty rules | Integration verification guidance; no claim that all POS systems work automatically |
| [Smile](https://smile.io/features/analytics) | Visible rewards, bonus campaigns and understandable analytics | Visual multiplier/bonus editor and explicit metric definitions |
| [LoyaltyLion](https://loyaltylion.com/customers/ogee) | Attainable first rewards and ongoing communication | First-reward review in onboarding; communication automation remains separate |
| [Yotpo](https://support.yotpo.com/v1/docs/creating-targeted-loyalty-campaigns-using-lists-segments) | Clearly defined campaign audiences and eligibility | Clear current rule conditions; no audience targeting invented where PF does not support it |
| [SumUp Connect / FiveStars](https://www.sumup.com/en-us/loyalty-program/) | Enrollment at the counter and returning-customer journeys | QR at checkout and evidence-based next actions |
| [TapMango](https://www.tapmango.com/product/crm-segmentation/) | Customer behavior and location-aware operations | Branch scoping and repeat-purchase measures; advanced segmentation is a later extension |

Vendor case studies describe outcomes with selection and attribution limitations. They are not controlled experiments or PF forecasts. Recorded sales are not incremental revenue or ROI.

## Framework selection

| Option | Decision for PF |
| --- | --- |
| [Mantine](https://mantine.dev/guides/vite/) | Selected: maintained forms, shell, controls and themes; MIT; React aligns with existing team knowledge |
| [Recharts via Mantine](https://mantine.dev/charts/getting-started/) | Selected: ordinary business charts, keyboard navigation and a separate accessible data table |
| [Ant Design](https://ant.design/components/table/) | Strong alternative when dense editable tables dominate |
| [Frappe UI](https://ui.frappe.io/docs/getting-started/standalone) | Viable with Express: UI components do not require Frappe backend; would introduce Vue/Tailwind |
| [Frappe Framework](https://docs.frappe.io/framework/user/en/basics/architecture) | Broader Python/Bench platform migration; unnecessary for this UI task |
| [PrimeVue](https://primevue.dev/vite/) | Strong forms/tables; current 5.x has PrimeUI license/key terms, while 4.x remains MIT; do not assume old licensing applies |
| [Tabler](https://docs.tabler.io/ui/getting-started/) | Fast incremental HTML option; more state wiring remains application-owned; chart examples have separate licensing |
| [shadcn/ui](https://ui.shadcn.com/docs) | Good control, but copied source increases application-owned maintenance |
| [Apache Superset](https://superset.apache.org/user-docs/using-superset/embedding/) | Later advanced BI; extra service, guest-token and tenant-policy integration |
| [Metabase](https://www.metabase.com/embedding) | Later embedded reporting candidate; evaluate embedding and commercial requirements for exact edition |
| [Frappe Insights](https://docs.frappe.io/insights/permissions-access-control/enable-permissions) | External PostgreSQL support does not inherit Frappe-site user permissions; explicit PF tenant isolation required |
| [Apache ECharts](https://echarts.apache.org/handbook/en/best-practices/aria/) | Good future specialized charting option; ARIA descriptions and patterns |
| [Chart.js](https://www.chartjs.org/docs/latest/general/accessibility.html) | Viable canvas charts; requires application-provided accessible alternatives |
| [AG Grid Community](https://www.ag-grid.com/react-data-grid/community-vs-enterprise/) | Reserve for genuine spreadsheet-style needs |
| [TanStack Table](https://tanstack.com/table/latest/docs/overview) | Headless logic, not a ready-made grid; unnecessary for current small tables |

## Delivered scope and remaining opportunities

The merchant overview counts genuine purchases, customers with two or more purchases in the selected period, sales recorded by PF and completed redemptions. Equal local-calendar comparison windows end at the same clock time. Reversed transactions, empty awards and unrelated point bonuses are excluded. The interface distinguishes missing ratios from zero counts and explains coverage.

Campaign forms use existing supported recurring weekday/hour/amount/visit/item rules. Templates create disabled drafts. Save is explicit; no messages are sent. Existing unfamiliar configurations go to advanced administration. The launch guide links branding, earning, rewards, QR enrollment, staff testing and POS setup.

Next candidates: cohort retention and customer lifetime reporting with documented formulas; branch-level reconciliation and POS health; reliable message delivery with consent and suppression controls; campaign cohorts/holdouts before claiming incremental lift; additional validated POS adapters; multi-currency and locale support based on real LATAM pilot needs. These are opportunities, not features shipped by this release.

A production pilot still needs verified code delivery, real checkout/refund reconciliation and physical Apple/Google Wallet acceptance. A clear dashboard does not substitute for those checks.
