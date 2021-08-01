import { IMacro } from "../macro";
import { MacroUtils } from "../macro-utils";

export class CreateEcho implements IMacro {
  public async run(): Promise<void> {
    const actor = MacroUtils.getActorFromContext();

    const originActor = actor.getFlag('world', 'is-echo-of') ? game.actors.get(actor.getFlag('world', 'is-echo-of')) : actor;
    const scene = game.scenes.get(game.user.viewedScene);
    const actorData = JSON.parse(JSON.stringify(originActor.data));
    let currentSceneToken: Token;
    for (const sceneToken of scene.data.tokens) {
      if (sceneToken.data.actorId === actorData._id) {
        currentSceneToken = sceneToken;
        break;
      }
    }
    if (!currentSceneToken) {
      ui.notifications.error("There is no token on the scene");
      return;
    }
  
    const echoTokenData = {
      ...actorData.token,
      actorLink: true,
      actorData: {},
      scale: actorData.token.scale * 0.7,
      brightLight: 0,
      brightSight: 0,
      dimLight: 0,
      dimSight: 10,
      name: `Echo (${actorData.name})`,
      tint: "#4b4b4b",
    }
  
    const echoActorData = {
      data: {
        abilities: {},
        attributes: {
          hp: {value: 1, max: 1},
          ac: {
            calc: 'default',
            flat: 14 + actorData.data.attributes.prof
          },
          movement: {
            walk: 30,
            fly: 30,
            hover: true
          }
        },
        traits: {
          ci: {
            value: ["blinded","charmed","deafened","frightened","grappled","incapacitated","invisible","paralyzed","petrified","poisoned","prone","restrained","stunned","exhaustion"]
          }
        }
      },
      effects: [],
      flags: {
        world: {
          'is-echo-of': actorData._id,
        },
        "midi-qol": {
          fail: {
            skill: {
              all: 1
            }
          }
        }
      },
      folder: 'TIDda1pvaOJgA685',
      img: actorData.img,
      items: actorData.items,
      name: `Echo (${actorData.name})`,
      permissions: actorData.permissions,
      token: echoTokenData,
      type: actorData.type
    }
  
    // Inherited stats from actor
    for (const ability of Object.keys(actorData.data.abilities)) {
      echoActorData.data.abilities[ability] = {
        value: actorData.data.abilities[ability].value,
        proficient: actorData.data.abilities[ability].proficient,
      }
    }
  
    let echoActor = game.actors.get(originActor.getFlag('world', 'echo-actor-id'));
    if (echoActor) {
      echoActor = (await CONFIG.Actor.documentClass.updateDocuments([{...echoActorData, _id: echoActor.data._id}]))[0];
    } else {
      echoActor = (await CONFIG.Actor.documentClass.createDocuments([echoActorData]))[0];
      originActor.setFlag('world', 'echo-actor-id', echoActor.data._id);
    }
  
    let echoToken = {
      ...echoActor.data.token,
      actorId: echoActor.id,
      x: currentSceneToken.data.x,
      y: currentSceneToken.data.y,
      zIndex: 2,
    };
    for (const sceneToken of scene.data.tokens) {
      if (sceneToken.data.actorId === echoActor.data._id) {
        echoToken._id = sceneToken._id;
        break;
      }
    }
  
    if (echoToken._id) {
      await scene.updateEmbeddedDocuments('Token', [echoToken], {animate: false} as any);
    } else {
      await scene.createEmbeddedDocuments('Token', [echoToken]);
    }
  
    let actorCanvasToken;
    let echoCanvasToken;
    for (const token of (canvas.tokens.objects.children as Token[])) {
      if (token.data.actorId === actor.id) {
        actorCanvasToken = token;
      }
      if (token.data.actorId === echoActor.id) {
        echoCanvasToken = token;
      }
    }
    
    if (actorCanvasToken && echoCanvasToken) {
      echoCanvasToken.zIndex = actorCanvasToken.zIndex+1;
    }
  }
}