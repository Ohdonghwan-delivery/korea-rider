// v1.5.2 · 미니멀 기사 위치 지도
export const RIDER_MAP_HTML = `<!doctype html><html lang="ko"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"/>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<style>html,body,#map{height:100%;width:100%;padding:0;margin:0;background:#E7EDF5}.leaflet-container{font-family:Arial,sans-serif}.rider-pin{height:18px;width:18px;border-radius:50%;background:#2385EF;border:3px solid white;box-shadow:0 2px 7px #10233C66}.leaflet-control-attribution{font-size:9px!important}.leaflet-control-zoom{border:0!important;box-shadow:0 2px 8px #10233C20!important}.leaflet-control-zoom a{border:0!important}</style></head><body><div id="map"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script><script>(function(){
const send=x=>{try{window.ReactNativeWebView.postMessage(JSON.stringify(x))}catch(e){}};
if(!window.L){send({type:'map-error',message:'지도 라이브러리를 불러오지 못했습니다.'});return;}
const map=L.map('map',{zoomControl:true}).setView([35.1595,126.8526],12);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap'}).addTo(map);
const markers=new Map();let fitted=false;
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
window.__KD_UPDATE_RIDERS=function(data){const list=Array.isArray(data)?data:[];const ids=new Set();for(const r of list){const lat=Number(r.latitude),lng=Number(r.longitude);if(r.latitude==null||r.longitude==null||!Number.isFinite(lat)||!Number.isFinite(lng)||Math.abs(lat)>90||Math.abs(lng)>180)continue;const id=String(r.rider_id||r.id||'');if(!id)continue;ids.add(id);let marker=markers.get(id);if(!marker){marker=L.marker([lat,lng],{icon:L.divIcon({className:'',html:'<div class="rider-pin"></div>',iconSize:[24,24],iconAnchor:[12,12]})}).addTo(map);markers.set(id,marker)}else marker.setLatLng([lat,lng]);marker.bindPopup('<b>'+esc(r.rider_name||id)+'</b><br/>'+esc(id));}
for(const [id,marker] of markers){if(!ids.has(id)){map.removeLayer(marker);markers.delete(id)}}if(!fitted&&markers.size){map.fitBounds(L.featureGroup([...markers.values()]).getBounds().pad(.3),{maxZoom:15});fitted=true}};
window.__KD_FOCUS_RIDER=function(id){const m=markers.get(String(id));if(m){map.setView(m.getLatLng(),16);m.openPopup()}};
window.__KD_MAP_RESIZE=function(){setTimeout(()=>map.invalidateSize(),120)};
map.whenReady(()=>send({type:'map-ready'}));})();</script></body></html>`;
