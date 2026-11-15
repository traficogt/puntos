// Layout adapted from Meta Astryx's MIT-licensed side-gallery page template.
import React from 'react';
import {Brand,VStack,HStack,Grid,Heading,Button,Icon,Layout,LayoutContent,Collapsible} from './ui';
import RewardCard from './RewardCard';

const steps=[
  ['Un programa a tu medida','Elige qué premiar y cuánto puedes invertir. Con reglas que tu equipo pueda explicar.'],
  ['Una tarjeta siempre a mano','Tus clientes consultan su progreso desde el navegador o una tarjeta en Wallet.'],
  ['Una próxima visita con sentido','Reconoce a quien vuelve y revisa lo que ocurre con datos que puedas entender.'],
];
export default function Landing(){
 return <>
  <header className="marketing-nav container"><Brand/><HStack gap={6} vAlign="center"><a className="desktop-link" href="#como-funciona">Cómo funciona</a><a className="desktop-link" href="#tu-negocio">Tu negocio</a><Button label="Explorar el panel" href="#panel" variant="secondary" size="sm" endContent={<Icon icon="arrowRight"/>}/></HStack></header>
  <main id="contenido">
    <section className="hero container">
      <Layout contentWidth={1400} content={<LayoutContent padding={6}>
        <Grid columns={{minWidth:320,repeat:'fit'}} gap={8} align="center">
          <VStack gap={6} className="hero-copy">
            <Heading level={1} className="hero-title">Que vuelvan.<br/>Que se sientan<br/><em>en casa.</em></Heading>
            <p className="hero-description">Convierte una compra en una relación. Un programa de lealtad sencillo para tus clientes, claro para tu equipo y bajo tu control.</p>
            <HStack gap={3} wrap="wrap"><Button label="Conocer PuntosFieles" variant="primary" size="lg" href="#como-funciona" endContent={<Icon icon="arrowRight"/>}/><Button label="Verlo en acción" href="#panel" variant="ghost" size="lg"/></HStack>
            <p className="hero-footnote">Tarjetas digitales. Recompensas claras. Sin complicar el día.</p>
          </VStack>
          <VStack className="hero-scene">
            <img className="hero-art" src="/images/articles/funcionan-1152.webp" alt="Una clienta vuelve a un pequeño negocio donde la reciben por su nombre." width="1152" height="768" fetchPriority="high"/>
            <VStack className="hero-card"><RewardCard compact/></VStack>
          </VStack>
        </Grid>
      </LayoutContent>}/>
    </section>
    <HStack className="business-strip container" wrap="wrap" gap={6} hAlign="between"><span>Para los negocios<br/><strong>que hacen comunidad.</strong></span><span>Comercios</span><span>Salones</span><span>Gimnasios</span><span>Restaurantes</span><span>Servicios</span></HStack>
    <section className="how-section container" id="como-funciona">
      <HStack className="section-heading" hAlign="between" gap={6} wrap="wrap"><Heading level={2}>Fácil de empezar.<br/><em>Fácil de seguir.</em></Heading><p>No necesitas reinventar tu negocio.<br/>Solo dar un buen motivo para volver.</p></HStack>
      <Grid columns={{minWidth:260,repeat:'fit'}} gap={8}>{steps.map(([title,description],index)=><VStack gap={4} key={title} className="journey-step"><span className="step-index">{index+1}</span><Heading level={3}>{title}</Heading><p>{description}</p></VStack>)}</Grid>
    </section>
    <section className="owner-section" id="tu-negocio"><HStack className="container owner-inner" gap={10} vAlign="center" wrap="wrap">
      <VStack gap={6} className="owner-copy"><Heading level={2}>Tu programa.<br/>Tus decisiones.<br/><em>Sin adivinar.</em></Heading><p>Entiende qué pasó, qué merece tu atención y cuánto has prometido en recompensas. Un panel pensado para el día a día.</p><Button label="Probar el panel de negocio" href="#panel" variant="secondary" size="lg" endContent={<Icon icon="arrowRight"/>}/></VStack>
      <VStack className="owner-preview" gap={5} padding={8}>
        <HStack hAlign="end"><span>Ejemplo</span></HStack><Heading level={3}>Hay 12 clientes a quienes<br/>vale la pena volver a invitar.</Heading><p>Revisa cuándo vinieron, define una oferta y ponle un límite antes de activarla.</p><HStack gap={3} className="preview-people"><span>AM</span><span>CR</span><span>LG</span><span>+9</span></HStack><Button label="Revisar audiencia de ejemplo" variant="primary" href="#panel"/>
      </VStack>
    </HStack></section>
    <section className="faq-section container"><Heading level={2}>Antes de dar<br/><em>el siguiente paso.</em></Heading><VStack gap={0} className="faqs">
      <Collapsible defaultIsOpen={false} trigger="¿Mis clientes necesitan instalar una app?"><p>Pueden consultar su tarjeta desde el navegador. También hay opciones para guardarla en Apple Wallet o Google Wallet, según la configuración del programa.</p></Collapsible>
      <Collapsible defaultIsOpen={false} trigger="¿Puedo usar mi sistema de ventas?"><p>PF puede conectarse con sistemas compatibles mediante integraciones. Revisamos tu POS y sus capacidades antes de prometer una conexión automática.</p></Collapsible>
      <Collapsible defaultIsOpen={false} trigger="¿Puedo controlar el costo de las recompensas?"><p>Puedes definir costos, límites y condiciones. Las estimaciones dependen de los datos que registres y se distinguen de las ventas observadas.</p></Collapsible>
    </VStack></section>
    <section className="closing container"><Heading level={2}>Una buena visita<br/>merece <em>otra.</em></Heading><Button label="Explorar la demostración" href="#panel" variant="primary" size="lg" endContent={<Icon icon="arrowRight"/>}/></section>
  </main>
  <footer className="site-footer container"><Brand/><p>Una exploración de PuntosFieles con Astryx.</p><a href="https://viasolvia.com" target="_blank" rel="noreferrer">Por Viasolvia</a></footer>
 </>;
}
