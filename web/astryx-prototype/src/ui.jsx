import React from 'react';
import {Icon as AstryxIcon} from '@astryxdesign/core/Icon';
import {ArrowRight,Plus,Moon,Sun,Users} from 'lucide-react';
export {Button} from '@astryxdesign/core/Button';
const customIcons={arrowRight:ArrowRight,plus:Plus,moon:Moon,sun:Sun,users:Users};
export function Icon({icon,...props}) {return <AstryxIcon icon={customIcons[icon]??icon} {...props}/>;}
export {Badge} from '@astryxdesign/core/Badge';
export {Avatar} from '@astryxdesign/core/Avatar';
export {VStack} from '@astryxdesign/core/VStack';
export {HStack} from '@astryxdesign/core/HStack';
export {Grid} from '@astryxdesign/core/Grid';
export {Heading} from '@astryxdesign/core/Heading';
export {Text} from '@astryxdesign/core/Text';
export {Card} from '@astryxdesign/core/Card';
export {Layout, LayoutContent} from '@astryxdesign/core/Layout';
export {ProgressBar} from '@astryxdesign/core/ProgressBar';
export {Switch} from '@astryxdesign/core/Switch';
export {Slider} from '@astryxdesign/core/Slider';
export {TextInput} from '@astryxdesign/core/TextInput';
export {NumberInput} from '@astryxdesign/core/NumberInput';
export {Selector} from '@astryxdesign/core/Selector';
export {SegmentedControl, SegmentedControlItem} from '@astryxdesign/core/SegmentedControl';
export {TabList, Tab} from '@astryxdesign/core/TabList';
export {Collapsible} from '@astryxdesign/core/Collapsible';

export const money = value => new Intl.NumberFormat('es-GT', {style:'currency', currency:'GTQ', maximumFractionDigits:0}).format(value);
export function Brand() {
  return <a className="brand" href="#inicio" aria-label="PuntosFieles, inicio del prototipo"><img src="/icon.svg" width="32" height="32" alt="" /><span>PuntosFieles<span className="brand-dot">.</span></span></a>;
}
export function SampleNote({children='Datos de ejemplo. Los cambios solo viven en esta demostración.'}) {
  return <p className="sample-note">{children}</p>;
}
