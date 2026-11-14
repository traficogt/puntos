# Auditoría editorial: cuántas visitas para una recompensa

Revisión: 14 de noviembre de 2026. Archivo público propuesto: `cuantas-visitas-para-una-recompensa.json`. Estas notas acompañan al borrador como evidencia interna; no contienen instrucciones de publicación.

## Alcance y voz

- Cuerpo de 648 palabras, incluidos cuatro encabezados y el cálculo; bibliografía y nota metodológica aparte.
- Tema exclusivo: umbral, ritmo real, tiempo pendiente, recompensa y costo. No se presenta un número universal de visitas.
- Se leyeron las instrucciones del repositorio, el estilo de ilustración y el artículo aprobado, además de los registros de investigación locales.
- Estilo designado, leído directamente: https://edu.tallerlumiere.com/tecnica/exposicion-i/ y https://edu.tallerlumiere.com/perfiles/albert-renger-patzsch/ . Prosa explicativa, definiciones breves y ejemplo progresivo. Sin copiar frases ni experiencias.

## Fuentes originales y pasajes

### Kivetz, Urminsky y Zheng (2006)

- Versión publicada del artículo, alojada por la universidad: https://business.columbia.edu/sites/default/files-efs/pubfiles/1200/goalgradient.pdf . 21 páginas de archivo: artículo pp. 39–58 y aviso de derechos. DOI https://doi.org/10.1509/jmkr.43.1.39 . Autoría, fecha, revista y páginas constan en la primera página.
- Cotejo con la copia suministrada y su texto: `/var/lib/puntos/research/points-literature-20261111/extracted-text/01_Kivetz-Urminsky-Zheng_2006_goal-gradient_JMR.pdf.txt`.
- Pasajes usados: pp. 42–43 (PDF 4–5), métodos y resultados del café; p. 40, alcance de los distintos estudios y reinicio posterior al premio.
- Comprobado: disminuye el intervalo entre compras al acercarse al canje. El conjunto principal reúne tarjetas completadas, con controles adicionales; el artículo combina métodos. No se convierte ese resultado en un óptimo de diez compras, un aumento de consumo total ni una estimación de beneficio.

### Liu (2007)

- Original publicado alojado por la autora: https://www.yupingliu.com/files/papers/liu_loyalty_program_effects.pdf . *Journal of Marketing, 71*(4), 19–35, DOI https://doi.org/10.1509/jmkg.71.4.019 . Cabecera, autoría, volumen y paginación contrastados en el PDF.
- Pasajes: p. 24 (PDF 6), muestra y datos; pp. 30–31 (PDF 12–13), comprobaciones, discusión y límites; resumen p. 19, contraste entre actividad inicial y canjes.
- Comprobado: 1.000 miembros con al menos dos compras; dos años; compradores intensivos sin el crecimiento observado en grupos menos activos. Sin control individual comparable de no miembros: no atribución causal completa. La limitación de excluir compradores de una sola visita se conserva en la nota pública.

## Aritmética y supuestos del ejemplo

El café, precios, costos y ritmos son ficticios. Se entrega el primer sello hoy; cada compra posterior suma uno; el premio se entrega con la última compra requerida. No se infiere ningún ritmo típico de Guatemala.

| Umbral | Compras restantes | Intervalo de 1 semana | Intervalo de 2 semanas |
| --- | ---: | ---: | ---: |
| 6 compras | 5 | 5 semanas | 10 semanas |
| 10 compras | 9 | 9 semanas | 18 semanas |

Cuenta verificada: espera = (umbral − 1) × intervalo. Si el canje requiere otra visita, ese tiempo se añade; el texto lo explica.

| Umbral | Ventas a Q30 | Costo del premio | Costo por compra | Costo / ventas |
| --- | ---: | ---: | ---: | ---: |
| 6 | Q180 | Q6 | Q1 | 3,333… %, publicado 3,33 % |
| 10 | Q300 | Q6 | Q0,60 | 2 % |

Todas las compras se suponen de Q30 y todos completan/canjean. Es reparto del costo directo, no margen ni retorno incremental. El texto excluye de esa cuenta los costos de compras pagadas y operación, e identifica posible sustitución de compras. No se incorpora una tasa ficticia de abandono para abaratar la promesa.

## Propuestas y límites editoriales

Revisar cohortes, escuchar clientes, mostrar el esfuerzo restante y probar un umbral son recomendaciones de PF, no tratamientos validados por estos trabajos. Un registro de antes y después no se llama experimento. El resultado cualitativo de entrevistas no se confunde con compras posteriores.

Dos originales, ambos citados con etiquetas exactas, sin referencias no utilizadas. Se consultaron métodos, resultados y límites relevantes de los documentos completos. No se reanalizaron microdatos ni se verificaron suplementos no enlazados. La descarga directa con `urllib` del PDF de Liu devolvió 406, pero su contenido completo se consultó mediante la herramienta web; no afectó el acceso a los pasajes. Se declara el interés comercial de PF y la falta de validación específica para Guatemala.
