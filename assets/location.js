(() => {
    const form=document.querySelector('#report-form');
    if(!form?.elements.latitude)return;
    const latitude=form.elements.latitude,longitude=form.elements.longitude,zoom=form.elements.map_zoom,style=form.elements.map_style;
    if(!zoom.value)zoom.value='15';
    const message=document.querySelector('#location-message'),image=document.querySelector('#location-map');
    let lastKey='',objectUrl='',pending=false,requestSequence=0;
    function changed(){form.dispatchEvent(new CustomEvent('fox-section-edit',{detail:{sections:[12]}}));}
    async function refresh(){
        const lat=Number(latitude.value),lng=Number(longitude.value);
        if(latitude.value.trim()===''||longitude.value.trim()===''||!Number.isFinite(lat)||!Number.isFinite(lng)||Math.abs(lat)>90||Math.abs(lng)>180){
            image.hidden=true;message.textContent='Renseignez des coordonnées valides pour afficher la carte.';return;
        }
        const parameters=new URLSearchParams({latitude:String(lat),longitude:String(lng),map_zoom:zoom.value,map_style:style.value});
        const key=parameters.toString();if(key===lastKey&&objectUrl)return;
        if(!navigator.onLine){image.hidden=true;message.textContent='Carte indisponible hors connexion. Les coordonnées seront conservées et synchronisées.';return;}
        const sequence=++requestSequence;
        try{
            message.textContent='Chargement de la carte…';
            const response=await fetch(`carte.php?${parameters}`,{cache:'no-store'});
            if(!response.ok){const result=await response.json();throw new Error(result.error||'Carte indisponible.');}
            const blob=await response.blob();if(sequence!==requestSequence)return;
            if(objectUrl)URL.revokeObjectURL(objectUrl);
            objectUrl=URL.createObjectURL(blob);image.src=objectUrl;image.hidden=false;lastKey=key;
            message.textContent='Cliquez sur le point souhaité pour corriger le repère. Carte et crédits affichés intégralement.';
        }catch(error){if(sequence!==requestSequence)return;image.hidden=true;message.textContent=`${error.message} Les coordonnées restent enregistrables.`;}
    }
    document.querySelector('#use-position').onclick=()=>{
        if(!navigator.geolocation){message.textContent='Géolocalisation indisponible. Saisissez les coordonnées manuellement.';return;}
        if(pending)return;
        pending=true;message.textContent='Recherche de position…';
        navigator.geolocation.getCurrentPosition(position=>{
            pending=false;
            const point=position.coords;
            if(!confirm(`Position : ${point.latitude.toFixed(7)}, ${point.longitude.toFixed(7)}. Précision estimée : ±${Math.round(point.accuracy)} m. Confirmer ce point ?`)){
                message.textContent='Position non confirmée : coordonnées inchangées.';return;
            }
            latitude.value=point.latitude.toFixed(7);longitude.value=point.longitude.toFixed(7);changed();refresh();
        },error=>{
            pending=false;
            message.textContent=error.code===1?'Position refusée : saisissez latitude et longitude manuellement.':error.code===3?'Délai dépassé : réessayez ou saisissez les coordonnées.':'Position indisponible : saisissez les coordonnées manuellement.';
        },{enableHighAccuracy:true,timeout:15000,maximumAge:0});
    };
    document.querySelector('#refresh-map').onclick=refresh;
    [latitude,longitude,zoom,style].forEach(control=>control.addEventListener('change',()=>{changed();refresh();}));
    image.onclick=event=>{
        if(form.querySelector('fieldset').disabled)return;
        const rect=image.getBoundingClientRect(),z=Number(zoom.value),world=256*2**z;
        const lat=Number(latitude.value),lng=Number(longitude.value);
        const sine=Math.sin(Math.max(-85.05112878,Math.min(85.05112878,lat))*Math.PI/180);
        const x=(lng+180)/360*world+(event.clientX-rect.left-rect.width/2)*640/rect.width;
        const y=(.5-Math.log((1+sine)/(1-sine))/(4*Math.PI))*world+(event.clientY-rect.top-rect.height/2)*360/rect.height;
        const newLng=((x/world*360-180+540)%360)-180;
        const newLat=Math.atan(Math.sinh(Math.PI*(1-2*y/world)))*180/Math.PI;
        if(!confirm(`Déplacer le repère vers ${newLat.toFixed(7)}, ${newLng.toFixed(7)} ?`))return;
        latitude.value=newLat.toFixed(7);longitude.value=newLng.toFixed(7);changed();refresh();
    };
    window.addEventListener('offline',()=>{image.hidden=true;message.textContent='Carte indisponible hors connexion ; coordonnées conservées.';});
    window.addEventListener('pagehide',()=>{if(objectUrl)URL.revokeObjectURL(objectUrl);});
})();
