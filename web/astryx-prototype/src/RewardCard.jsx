import React, {useState} from 'react';
import {VStack,HStack,Button,Badge,Icon,ProgressBar} from './ui';

export default function RewardCard({compact=false}) {
  const [points,setPoints]=useState(320);
  const [redeemed,setRedeemed]=useState(false);
  const ready=points>=500;
  return <VStack gap={4} className={`reward-demo ${compact?'compact':''}`}>
    <VStack gap={5} className="member-card" padding={6}>
      <HStack hAlign="between" vAlign="center"><strong>Casa Jacaranda</strong><Badge label="Ejemplo" /></HStack>
      <VStack gap={1}><span className="card-member">LA TARJETA DE ANA</span><p className="point-total"><span aria-live="polite">{points}</span> <small>puntos</small></p></VStack>
      <VStack gap={2}>
        <ProgressBar label="Progreso hacia la recompensa" value={points} max={500} isLabelHidden variant="accent" />
        <p className="reward-caption" aria-live="polite">{redeemed?'Recompensa canjeada en la demo.':ready?'Tu recompensa está lista.':`Te faltan ${500-points} puntos para tu recompensa.`}</p>
      </VStack>
      <HStack hAlign="between" vAlign="center"><span className="card-footer">PuntosFieles</span><Icon icon="check" /></HStack>
    </VStack>
    <HStack gap={2} wrap="wrap">
      <Button label={ready?'Canjear en la demo':'Simular una visita'} variant="primary" icon={<Icon icon={ready?'check':'plus'} />} onClick={()=>{if(ready){setPoints(p=>p-500);setRedeemed(true);}else{setPoints(p=>Math.min(500,p+60));setRedeemed(false);}}} />
      <Button label="Reiniciar" variant="ghost" size="sm" onClick={()=>{setPoints(320);setRedeemed(false);}} />
    </HStack>
    {!compact&&<p className="microcopy">Cada visita de ejemplo suma 60 puntos. No se emite una tarjeta real.</p>}
  </VStack>;
}
