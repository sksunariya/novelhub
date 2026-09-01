import{c as l,d as j,r as k,j as s}from"./index-DLnAUfFG.js";/**
 * @license lucide-react v0.414.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const $=l("ArrowBigDown",[["path",{d:"M15 6v6h4l-7 7-7-7h4V6h6z",key:"1thax2"}]]);/**
 * @license lucide-react v0.414.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const C=l("ArrowBigUp",[["path",{d:"M9 18v-6H5l7-7 7 7h-4v6H9z",key:"1x06kx"}]]),N=e=>e==null?"–":Math.abs(e)<1e3?String(e):`${(e/1e3).toFixed(e%1e3===0?0:1)}k`,B=({post:e,orientation:d="vertical",size:u="md",target:x="post"})=>{const{vote:v,viewOf:h,votingEnabled:m,allowDownvotes:p}=j(),w=k.useId(),f=e.id||e._id,{value:t,score:n}=h(e),i=e.scoreHidden;if(!m)return null;const g=u==="sm"?"h-4 w-4":"h-5 w-5",y=d==="vertical"?"flex-col gap-0.5":"flex-row items-center gap-1",a=o=>{const r=t===o,b=o===1?C:$,c=o===1?"Upvote":"Downvote";return s.jsx("button",{type:"button",onClick:()=>v(f,o,t,n,x),"aria-pressed":r,"aria-label":r?`Remove ${c.toLowerCase()}`:c,className:`cursor-pointer rounded p-1 transition-colors ${r?o===1?"text-crimson":"text-sky-400":"text-silver-muted hover:bg-night-raised hover:text-silver"}`,children:s.jsx(b,{className:g,"aria-hidden":"true",fill:r?"currentColor":"none"})})};return s.jsxs("div",{className:`flex ${y}`,children:[a(1),s.jsx("span",{className:`min-w-[2ch] text-center text-xs font-semibold tabular-nums ${t===1?"text-crimson":t===-1?"text-sky-400":"text-silver"}`,"aria-hidden":"true",children:i?"–":N(n)}),s.jsx("span",{id:w,role:"status","aria-live":"polite",className:"sr-only",children:i?"Score hidden while this post is new":`Score ${n}${t===1?", you upvoted":t===-1?", you downvoted":""}`}),p&&a(-1)]})};export{B as V};
