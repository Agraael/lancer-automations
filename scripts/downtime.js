export async function executeDowntime() {
    let terms;
    let rollTermName;
    let activityTermName;
    let outcomeTermName;
    let locationTermName;
    let missionTermName;
    let skillTermName;
    let objectiveTermName;
    let pilotNoteTermName;
    let gmNoteTermName;

    let termOptions = {
        roll: {
            diegetic: "//PROBABILITY COEFFICIENT",
            rulebook: "Roll"
        },
        activity: {
            diegetic: "//.EVAL(ACTIVITY)",
            rulebook: "Downtime Activity"
        },
        outcome: {
            diegetic: "PILOT.EVAL(ACTIVITY)",
            rulebook: "Outcome"
        },
        location: {
            diegetic: "//@LOC.DATA",
            rulebook: "Location"
        },
        mission: {
            diegetic: "#CENTCOM.OP-NAME",
            rulebook: "Mission"
        },
        skill: {
            diegetic: "//PILOT.MODUS",
            rulebook: "Skill"
        },
        objective: {
            diegetic: "//OBJ.THIS",
            rulebook: "Objective"
        },
        pilotNote: {
            diegetic: "//PILOT.LOG.NOTE",
            rulebook: "Pilot Note"
        },
        gmNote: {
            diegetic: "For Union Intelligence Analyst use only",
            rulebook: "For GM use only"
        }
    };

    function termSet(termMode) {
        terms = termMode;
        rollTermName = termOptions.roll[termMode],
        activityTermName = termOptions.activity[termMode],
        outcomeTermName = termOptions.outcome[termMode],
        locationTermName = termOptions.location[termMode],
        missionTermName = termOptions.mission[termMode],
        skillTermName = termOptions.skill[termMode],
        objectiveTermName = termOptions.objective[termMode],
        pilotNoteTermName = termOptions.pilotNote[termMode],
        gmNoteTermName = termOptions.gmNote[termMode];

        console.log(`Terms set to ${termMode} (valid options are 'diegetic or 'rulebook')`);
    }

    termSet('diegetic');

    let unionDate = () => {
        const date = new Date();
        let day = date.getDate();
        let month = date.getMonth() + 1;
        let year = date.getFullYear() + 2992;

        return `${year}${month}${day}`;
    };

    function makeid(length) {
        let result = '';
        const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        const charactersLength = characters.length;
        let counter = 0;
        while (counter < length) {
            result += characters.charAt(Math.floor(Math.random() * charactersLength));
            counter += 1;
        }
        return result;
    }

    let sessionId = makeid(20);

    function createRange(start, end) {
        if (start > end) {
            console.error("Start value should be less than or equal to the end value.");
            return [];
        }

        const array = [];
        for (let i = start; i <= end; i++) {
            array.push(i);
        }
        return array;
    }

    let Activities = [
        {
            Name: "Power At A Cost",
            Rollable: false,
            Description: "Name what you want. You can definitely get it, but\ndepending on the outlandishness of the request, the\nGM chooses one or two:\n• It's going to take a lot more time than you thought.\n• It's going to be really damn risky.\n• You'll have to have to give something up or leave\nsomething behind (e.g., wealth, resources, allies).\n• You're going to piss off someone or something\nimportant and powerful.\n• Things are going to go wildly off-plan.\n• You'll need more information to proceed safely.\n• It's going to fall apart damn soon.\n• You'll need more resources, but you know where\nto find them.\n• You can get something almost right: a lesser\nversion, or less of it.",
            Results: [
                {
                    ShortDesc: "Success",
                    LongDesc: "I'm resourceful, I can get what I need... or something very near to it. It's just a matter of time, manna and how much I'm willing to stick my neck out for it.",
                    Info: "<p>Name what you want. You can definitely get it, but depending on the outlandishness of the request, the GM chooses one or two:<ul><li>It's going to take a lot more time than you thought.</li><li>It's going to be really damn risky.</li><li>You'll have to have to give something up or leave something behind (e.g., wealth, resources, allies).</li> <li>You're going to piss off someone or something important and powerful.</li><li>Things are going to go wildly off-plan.</li> <li>You'll need more information to proceed safely.</li><li>It's going to fall apart damn soon.</li><li>You'll need more resources, but you know where to find them.</li> <li>You can get something almost right: a lesser version, or less of it.</li></p>"
                }
            ]
        },

        {
            Name: "Get Focused",
            Rollable: false,
            Description: "When you GET FOCUSED, you focus on increasing your\nown skills, training, and self-improvement. You might\npractice, learn, meditate, or call on a teacher.\nName what you want to learn or improve (e.g., a skill,\ntechnique, academic subject, or language). The GM will\ngive your pilot a new +2 trigger based on your practice\nand training. For example, the trigger could be +2 Playing\nChess or +2 Dancing. You can also improve a trigger\nfrom +2 to +4 or +4 to +6 by taking this downtime action.",
            Results: [
                {
                    ShortDesc: "Success",
                    LongDesc: "Sometimes, you just need to work on yourself. You never know when your honed <i>kapkat</i> skills will come in handy.",
                    Info: "<p>Name what you want to learn or improve (e.g., a skill, technique, academic subject, or language). The GM will give your pilot a new +2 trigger based on your practice and training. For example, the trigger could be +2 Playing Chess or +2 Dancing. You can also improve a trigger from +2 to +4 or +4 to +6 by taking this downtime action.</p>"
                }
            ]
        },

        {
            Name: "Buy Some Time",
            Rollable: true,
            Description: "When you BUY SOME TIME, you try to stave off a\nreckoning, extend a window of opportunity, or merely\nbuy some time and breathing room for you and your\ngroup. You might be trying to dodge some heat,\nsurvive stranded in the wilderness, or cause a\ndistraction so another plan can reach its climax. You\ncan use that distraction or bought time as RESERVES for\nthe next mission.\nDescribe your plan and roll:\nOn 9 or less, you can only buy a little time, and only if\ndrastic measures are taken right now. Otherwise,\nwhatever you're trying to stave off catches up to you.\nOn 10–19, you buy enough time, but the situation\nbecomes precarious or desperate. Next time you get\nthis result for the same situation, treat it as 9 or less.\nOn 20+, you buy as much time as you need, until the\nnext downtime session. Next time you get this result\nfor the same situation, treat it as 10–19.",
            Results: [
                {
                    RollRange: createRange(1, 9),
                    ShortDesc: "Mild Success",
                    LongDesc: "The situation is deteriorating quickly. Whatever I'm running from required some sacrifices to escape - or maybe I didn't escape it at all.",
                    Info: "You can only buy a little time, and only if drastic measures are taken right now. Otherwise,whatever you're trying to stave off catches up to you."
                },
                {
                    RollRange: createRange(10, 19),
                    ShortDesc: "Moderate Success",
                    LongDesc: "My situation has improved, but not by much. I bought a little time - for now. Next time, simple measures like this won't suffice.",
                    Info: "You buy enough time, but the situation becomes precarious or desperate. Next time you get this result for the same situation, treat it as 9 or less."
                },
                {
                    RollRange: createRange(20, 100),
                    ShortDesc: "Monumental Success",
                    LongDesc: "I got the time I needed, and then some. Whatever was dogging me has abated - for now.",
                    Info: "You buy as much time as you need, until the next downtime session. Next time you get this result for the same situation, treat it as 10–19."
                }
            ]
        },

        {
            Name: "Gather Information",
            Rollable: true,
            Description: "When you GATHER INFORMATION, you poke your nose\naround, perhaps where it doesn't belong, and\ninvestigate something – conducting research,\nfollowing up on a mystery, tracking a target, or\nkeeping an eye on something. You might head to a\nlibrary or go undercover to learn what you can.\nWhatever it involves, you're trying to GATHER\nINFORMATION on a subject of your choice. You can use\ninformation gained as RESERVES.\nName your subject and method, and roll:\nOn 9 or less, choose one:\n• You get what you're looking for, but it gets you\ninto trouble straight away.\n• You get out now and avoid trouble.\nOn 10–19, you find what you're looking for, but choose\none:\n• You leave clear evidence of your rummaging.\n• You have to dispatch someone or implicate\nsomeone innocent to avoid attention.\nOn 20+, you get what you're looking for with no\ncomplications.",
            Results: [
                {
                    RollRange: createRange(1, 9),
                    ShortDesc: "Mild Success",
                    LongDesc: "I got the info I wanted, but it cost me.",
                    Info: "<p>Choose one: <ul><li>You get what you're looking for, but it gets you into trouble straight away</li><li>You get out now and avoid trouble.</li></ul></p>"
                },
                {
                    RollRange: createRange(10, 19),
                    ShortDesc: "Moderate Success",
                    LongDesc: "I got the info I wanted, but not without some complications.",
                    Info: "You find what you're looking for, but choose one:<ul><li>You leave clear evidence of your rummaging.</li><li>You have to dispatch someone or implicate someone innocent to avoid attention.</li></ul>"
                },
                {
                    RollRange: createRange(20, 100),
                    ShortDesc: "Monumental Success",
                    LongDesc: "Mission accomplished. I got my intel, and I got out. No one was the wiser, and by the time they are - I'm gonna' be in the wind.",
                    Info: "You get what you're looking for with no complications."
                }
            ]
        },

        {
            Name: "Get A Damn Drink",
            Rollable: true,
            Description: "When you GET A DAMN DRINK, you blow off some\nsteam, carouse, and generally get into trouble. You\nmight be trying to make connections, collect gossip,\nforge a reputation, or even just to forget what\nhappened on the last mission. There's usually trouble.\nState your intention and roll:\nOn 9 or less, decide whether you had good time or\nnot; either way, you wake up in a gutter somewhere\nwith only one thing remaining:\n• Your dignity.\n• All of your possessions.\n• Your memory.\nOn 10–19, gain one as a reserve and lose one:\n• A good reputation.\n• A friend or connection.\n• A useful item or piece of information.\n• A convenient opportunity.\nOn 20+, gain two from the 10–19 list as RESERVES and\ndon't lose anything.",
            Results: [
                {
                    RollRange: createRange(1, 9),
                    ShortDesc: "Mild Success?",
                    LongDesc: "I'm not sure if last night was a great time or a terrible time but I woke up in a strange place and I feel like something is missing.",
                    Info: "Decide whether you had good time or not; either way, you wake up in a gutter somewhere with only one remaining:<ul><li>Your dignity.</li><li>All of your possessions.</li><li>Your memory.</li></ul>"
                },
                {
                    RollRange: createRange(10, 19),
                    ShortDesc: "Moderate Success",
                    LongDesc: "Things got a bit hazy after that 11th shot, but after checking my messages this morning I found that something happened last night.",
                    Info: "Gain one as RESERVES and lose one:<ul><li>A good reputation.</li><li>A friend or connection.</li><li>A useful item or piece of information.</li><li>A convenient opportunity.</li></ul>"
                },
                {
                    RollRange: createRange(20, 100),
                    ShortDesc: "Monumental Success",
                    LongDesc: "To say I'm the life of the party wherever I go would be the understatement of the  century. I definitely impressed someone important through either sheer liver-power or raw rizz. Whatever the case, I scored myself some pristine assets and woke up without a headache. Awesome.",
                    Info: "Gain two as RESERVES:<ul><li>A good reputation.</li><li>A friend or connection.</li><li>A useful item or piece of information.</li><li>A convenient opportunity.</li></ul>"
                }
            ]
        },

        {
            Name: "Get Creative",
            Rollable: true,
            Description: "When you GET CREATIVE, you tweak something or try to\nmake something new – either a physical item, or a piece\nof software. Once finished, you can use it as RESERVES.\nDescribe your project and roll:\nOn 9 or less, you don't make any progress on your\nproject. Next time you get this result for the same\nproject, treat it as a 10–19.\nOn 10–19, you make progress on your project, but\ndon't quite finish it. You can finish it during your next\ndowntime without rolling, but choose the two things\nyou're going to need:\n• Quality materials.\n• Specific knowledge or techniques.\n• Specialized tools.\n• A good workspace.\nOn 20+, you finish your project before the next\nmission. If it's especially complex, treat this as 10–19,\nbut only choose one.",
            Results: [
                {
                    RollRange: createRange(1, 9),
                    ShortDesc: "Failure",
                    LongDesc: "What a waste. All that time spent, and I dont have shit to show for it. Better luck next time, I guess.",
                    Info: "You don't make any progress on your project. Next time you get this result for the same project, treat it as a 10–19."
                },
                {
                    RollRange: createRange(10, 19),
                    ShortDesc: "Moderate Success",
                    LongDesc: "I am so close to being done with it. I will definitely finish it next time, but I'll need some stuff. I'll surely have whatever I need by then - right?",
                    Info: "You make progress on your project, but don't quite finish it. You can finish it during your next downtime without rolling, but choose the two things you're going to need:<ul><li>Quality materials.</li><li>Specific knowledge or techniques.</li><li>Specialized tools.</li><li>A good workspace.</li></ul>"
                },
                {
                    RollRange: createRange(20, 100),
                    ShortDesc: "Monumental Success",
                    LongDesc: "Project done and just in time for the next mission. Nice - I was looking forward to that...thing.",
                    Info: "You finish your project before the next mission. If it's especially complex, treat this as 10–19, but only choose one."
                }
            ]
        },

        {
            Name: "Get Organized",
            Rollable: true,
            Description: "When you GET ORGANIZED, you start, run, or improve an\norganization, business, or other venture.\nState your organization's purpose or goal, and\nchoose a FOCUS: military, scientific, academic, criminal,\nhumanitarian, industrial, entertainment, or political. It\nbegins with +2 in either EFFICIENCY or INFLUENCE and +0\nin the other, with a maximum of +6. EFFICIENCY\ndetermines how effectively your organization conducts\nactivities within its scope (e.g., a military organization\nwith high efficiency would be good at combat).\nINFLUENCE is its size, reach, wealth, and reputation.\nWhen your organization directly assists with an activity,\nyou may add either its EFFICIENCY or INFLUENCE as a\nstatistic bonus to your skill check. EFFICIENCY is used\nwhen performing activities related to your\norganization's FOCUS. INFLUENCE is used when acquiring\nassets, creating opportunities, or swaying public\nopinion. Advantages gained with the help of your\norganization can be used as RESERVES.\nEach downtime after the first, roll 1d20:\nOn 9 or less, choose one or your organization folds\nimmediately:\n• Your organization loses 2 EFFICIENCY and 2\nINFLUENCE, to a minimum of 0. If both are already\nat 0, you may not choose this.\n• Your organization needs to pay debts, make an\naggressive move, or get bailed out. You choose\nwhich, and the GM decides what that looks like.\nOn 10–19, your organization is stable. It gains +2\nEFFICIENCY or INFLUENCE, to a maximum of +6.\nOn 20+, your organization gains +2 EFFICIENCY and +2\nINFLUENCE, to a maximum of +6.",
            Results: [
                {
                    RollRange: createRange(1, 9),
                    ShortDesc: "Failure",
                    LongDesc: "Managing an organization is hard work, and today shit went wrong.",
                    Info: "Choose one or your organization folds immediately:<ul><li>Your organization loses 2 EFFICIENCY and 2 INFLUENCE, to a minimum of 0. If both are already at 0, you may not choose this.</li><li>Your organization needs to pay debts, make an aggressive move, or get bailed out. You choose which, and the GM decides what that looks like.</li></ul>"
                },
                {
                    RollRange: createRange(10, 19),
                    ShortDesc: "Moderate Success",
                    LongDesc: "Today was a good day. Things are chugging along and we're making waves.",
                    Info: "Your organization is stable. It gains +2 EFFICIENCY or INFLUENCE, to a maximum of +6."
                },
                {
                    RollRange: createRange(20, 100),
                    ShortDesc: "Monumental Success",
                    LongDesc: "Every once in a while things just come together. I managed to improve your processes and project your influence all in one fell swoop. Time to put my feet up after that one.",
                    Info: "Your organization gains +2 EFFICIENCY and +2 INFLUENCE, to a maximum of +6."
                }
            ]
        },

        {
            Name: "Get Connected",
            Rollable: true,
            Description: "When you GET CONNECTED, you make connections, call\nin favors, ask for help, or drum up support for a course\nof action. You can use your contacts' resources or aid\nas RESERVES for the next mission.\nName your contact and roll:\nOn 9 or less, your contact will help you, but you've got\nto do a favor or make good on a promise right now. If\nyou don't, they won't help you.\nOn 10–19, your contact will help you, but you've got\nto do a favor or make good on a promise afterwards.\nIf you don't follow through, treat this result as 9 or less\nnext time you get it for the same organization.\nOn 20+, your contact will help you, no strings\nattached. Treat this result as 10–19 next time you get\nit for the same organization.",
            Results: [
                {
                    RollRange: createRange(1, 9),
                    ShortDesc: "Mild Success",
                    LongDesC: "I know this guy, and he's got some useful tools and friends - but those connections don't come cheap. And he wants something from me before he's ready to do business.",
                    Info: "Your contact will help you, but you've got to do a favor or make good on a promise right now. If you don't, they won't help you."
                },
                {
                    RollRange: createRange(10, 19),
                    ShortDesc: "Moderate Success",
                    LongDesc: "Yeah, they're gonna come through for me. Though it's not gratis - after this, they're gonna call in a favor from me, I just know it. But fair is fair.",
                    Info: "Your contact will help you, but you've got to do a favor or make good on a promise afterwards. If you don't follow through, treat this result as 9 or less next time you get it for the same organization."
                },
                {
                    RollRange: createRange(20, 100),
                    ShortDesc: "Monumental Success",
                    LongDesc: "Damn I'm magnanimous. I mean seriously, people are just itching to help me - no strings attached.",
                    Info: "Your contact will help you, no strings attached. Treat this result as 10–19 next time you get it for the same organization."
                }
            ]
        },

        {
            Name: "Scrounge And Barter",
            Rollable: true,
            Description: "When you SCROUNGE AND BARTER, you try to get your\nhands on some gear or an asset by dredging the\nscrapyard, chasing down rumors, bartering in the local\nmarket, or hunting around.\nYou might want some better pilot gear, a vehicle,\nnarcotics, goods, or other sundries. It needs to be\nsomething physical, but doesn't necessarily have to\nbe on the gear list. If you get it, you can take it on the\nnext mission as RESERVES.\nName what you want and roll:\nOn 9 or less, you get what you're looking for, but\nchoose one:\n• It was stolen, probably from someone who's\nlooking for it.\n• It's degraded, old, filthy, or malfunctioning.\n• Someone else has it right now and won't give it\nup without force or convincing.\nOn 10–19, you get what you're looking for, but choose\nthe price you need to pay:\n• Time.\n• Dignity.\n• Reputation.\n• Health, comfort, and wellness. \nOn 20+, you get what you're looking for, no problem.",
            Results: [
                {
                    RollRange: createRange(1, 9),
                    ShortDesc: "Mild Success",
                    LongDesc: "I found what I was looking for, but not without a hitch.",
                    Info: "You get what you want, but choose one:<ul><li>It was stolen, probably from someone who's looking for it.</li><li>It's degraded, old, filthy, or malfunctioning.</li><li>Someone else has it right now and won't give it up without force or convincing.</li></ul>"
                },
                {
                    RollRange: createRange(10, 19),
                    ShortDesc: "Moderate Success",
                    LongDesc: "I got that piece, but it cost me.",
                    Info: "You get what you want, but choose the price you need to pay:<ul><li>Time.</li><li>Dignity.</li><li>Reputation.</li><li>Health, comfort, and wellness.</li></ul>"
                },
                {
                    RollRange: createRange(20, 100),
                    ShortDesc: "Monumental Success",
                    LongDesc: "Easy pickings. Wave around a little manna, flash the old sidearm, waggle the silver tongue - whatever it took, I got it, all above board - well mostly...probably...kinda.",
                    Info: "You get what you're looking for, no problem."
                }
            ]
        }
    ];

    let actList = Activities.map(act => `<option>${act.Name}</option>`).join('');

    let pilotData = {};

    let pilots = game.actors.filter(a => a.hasPlayerOwner && a.type === "pilot" && a.isOwner);
    let pilotNames = pilots.map(pilot => `<option value="${pilot.name}">${pilot.name}</option>`).join("");

    let dialogContent = `
    <div style="margin-bottom:1rem; font-family: monospace;">
        <h2 class="lancer-border-primary">Choose Pilot for Downtime Activity</h2>
            <img style="height:35px; border: none; top:1rem; position:relative" src="systems/lancer/assets/icons/license.svg">
            <select id="pilotpicker">${pilotNames}</select>
    </div>`;

    new Dialog({
        title: "Downtime: Pilot Selection",
        content: dialogContent,
        buttons: {
            submit: {
                label: "Proceed",
                callback: (html) => {
                    pilotData.name = html.find("#pilotpicker")[0].value;

                    let selectedActor = game.actors.find(n => n.name === pilotData.name);
                    let pilotSkills = selectedActor.collections.items.filter(i => i.type === 'skill');

                    pilotData.skills = pilotSkills
                        .map(s => {
                            let skillData = {
                                name: s.name,
                                description: s.name
                            };

                            let pilotSkill = pilotSkills.find(ps => ps.name === s.name);

                            if (pilotSkill) {
                                skillData.description = `${s.name} (Rank ${pilotSkill.system.curr_rank})`;
                                skillData.rank = pilotSkill.system.curr_rank;
                            }

                            return skillData;
                        });

                    let pilotSkillsHtml = `<option value="Generic">Generic (No Rank)</option>`;

                    pilotSkillsHtml += pilotData.skills.map(s => `<option value="${s.name}">${s.description}</option>`).join("");

                    let dialogContent = `<div style="margin:1rem; font-family: monospace; max-height: calc(85vh - 120px); overflow-y: auto; padding-right: 0.5rem;">
                        <h2 class="lancer-border-primary"><img style="height:35px; border: none; top:.5rem; position:relative" src="systems/lancer/assets/icons/campaign.svg">Campaign or Mission</h2>
                        <div style="margin-bottom:1rem; border-left: 2px; border-left-style: dotted; border-color:var(--primary-color, fuschia); padding-left: .5rem;">
                            <p style="text-align: right; font-style:italic;">#UAD.OP-DATA</p>
                            <label><b>Mission/Campaign Name</b></label>
                            <input style="display:inline; width:100%" placeholder="Awaiting operation name..." type="text" id="campaign"></input>
                            <label><b>Downtime Location</b></label>
                            <input type="text" style="display:inline; width:100%" id="location" placeholder="Quadrant, Line, Sector, Planet..."></location>
                            </div>
                        <h2 class="lancer-border-primary"><img style="height:35px; border: none; top:.5rem; position:relative" src="systems/lancer/assets/icons/downtime.svg">Downtime Activity</h2>
                        <div style="margin-bottom:1rem; border-left: 2px; border-left-style: dotted; border-color:var(--primary-color, fuschia); padding-left: .5rem; margin-bottom:1rem;">
                            <div style="margin-bottom:1rem">
                                <p style="text-align: right;font-style: italic">Choose a downtime activity for ${pilotData.name}</p>
                                <select id="activity" style="width:100%; margin-bottom:.5rem;">${actList}</select>
                                <div id="activityDescription" style="padding: 0.75rem; margin-bottom: 1rem; background-color: rgba(95, 158, 160, 0.2); border-left: 3px solid var(--primary-color, fuschia); font-style: italic; white-space: pre-line;"></div>
                                <h3 class="lancer-border-primary" style="text-align: right; margin-bottom:1rem; border-bottom: none;">Downtime Objective<img style="height:35px; border: none; top:.5rem; position:relative" src="systems/lancer/assets/icons/deployable.svg"></h3>
                                <p style="text-align: right; font-style:italic;">Describe what ${pilotData.name} is trying to achieve</p>
                                <textarea placeholder="Brief description of aim or goal of downtime activity" style="display:inline; width: 100%; height: 100px; background-color: transparent; border: 1px #00000085 solid; border-radius: 3px;" type="text" id="objective"></textarea>
                                <h3 class="lancer-border-primary" style="text-align: right; margin-bottom:1rem; border-bottom: none;">Apply your skills<img style="height:35px; border: none; top:.5rem; position:relative" src="systems/lancer/assets/icons/skill.svg"></h3>
                                <p style="text-align: right; font-style:italic;">Choose a relevant trigger for downtime activity</p>
                                <select id='triggers' style="width:100%">${pilotSkillsHtml}</select>

                                <div style="margin-top: 1rem; padding: 0.5rem; background-color: rgba(255, 200, 100, 0.2); border-left: 3px solid orange;">
                                    <label style="display: flex; align-items: center; cursor: pointer;">
                                        <input type="checkbox" id="manualRoll" style="margin-right: 0.5rem; width: 18px; height: 18px;">
                                        <span><b>Manual Roll Mode</b> - Enter physical dice result instead of automatic roll</span>
                                    </label>
                                    <div id="manualRollInput" style="display: none; margin-top: 0.5rem;">
                                        <label for="manualRollValue"><b>Physical Dice Result (1d20 + modifiers):</b></label>
                                        <input type="number" id="manualRollValue" style="width: 100px; margin-left: 0.5rem;" placeholder="1-100" min="1" max="100">
                                        <p style="font-size: 0.85em; font-style: italic; margin-top: 0.25rem;">Enter the total result from your physical dice roll (including all modifiers)</p>
                                    </div>
                                </div>

                                <div style="min-height: 100px; border: 5px dashed cadetblue; background-color: #5f9ea070; padding:.5rem; margin-top: .5rem;">
                                    <h3 style="text-align: right; border-bottom:none;">Probability Overrides<img style="height:35px; border: none; top:.5rem; position:relative" src="systems/lancer/assets/icons/tech_quick.svg"></h3>
                                    <p><sub style="text-align: right;">For Administrative use only: leave blank unless otherwise instructed</sub></p>
                                    <div style="text-align: right;">
                                        <label for="flat_mod">Flat Modifier Value: </label><input id="flatMod" style="width:60px;" placeholder="Any Int" name="flat_mod" type="number" min="-20" max="20">
                                        <textarea placeholder="Precision circumstantial modification coefficients. Add notes for ingestion by Evaluatory COMP/CON." style="display:inline; width: 100%; height: 50px; background-color: transparent; border: 1px #00000085 solid; border-radius: 3px;margin-top:5px;" type="text" id="flatOverrideNote"></textarea>
                                        <p>Accuracy/Difficulty Modifier</p>
                                        <button style="width:45px; height: 45px;" id="plusAcc"><img style="height:35px; border: none; top:.25rem; position:relative" src="systems/lancer/assets/icons/accuracy.svg"></button>
                                        <button style="width:45px; height: 45px;" id="plusDiff"><img style="height:35px; border: none; top:.25rem; position:relative" src="systems/lancer/assets/icons/difficulty.svg"></button>
                                        <input type="number" name="modifier" id="modifierAcc" value=0 style="height:45px;margin-left:1rem;width:60px; position:relative; top:-10px;"></input><br/>
                                        <textarea placeholder="Precision circumstantial modification coefficients, adjusted for causal free radicals. Add notes for ingestion by Evaluatory COMP/CON." style="display:inline; width: 100%; height: 50px; background-color: transparent; border: 1px #00000085 solid; border-radius: 3px;" type="text" id="modifierNote"></textarea>
                                        <p style="text-align:center; padding-top:.5rem;"> --- OR --- </p>
                                        <label for="default_override">Static Override Value: </label><input id="staticOverride" style="width:60px;" name="default_override" placeholder="1-100" type="number" min="1" max="100">
                                        <textarea placeholder="Full override, bypasses Probability matrices. Precognitive bandwidth may exceed administrative NHP allotment. Use sparingly. Add notes for ingestion by Evaluatory COMP/CON." style="display:inline; width: 100%; height: 50px; background-color: transparent; border: 1px #00000085 solid; border-radius: 3px;margin-top:5px;" type="text" id="staticOverrideNote"></textarea>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <script>
                        var activitiesData = ${JSON.stringify(Activities)};

                        function updateActivityDescription() {
                          const activitySelect = document.getElementById('activity');
                          const descriptionDiv = document.getElementById('activityDescription');
                          const selectedActivityName = activitySelect.value;

                          const selectedActivity = activitiesData.find(act => act.Name === selectedActivityName);

                          if (selectedActivity && selectedActivity.Description) {
                            descriptionDiv.textContent = selectedActivity.Description;
                            descriptionDiv.style.display = 'block';
                          } else {
                            descriptionDiv.textContent = '';
                            descriptionDiv.style.display = 'none';
                          }
                        }

                        updateActivityDescription();

                        document.getElementById('activity').addEventListener('change', updateActivityDescription);

                        document.getElementById('manualRoll').addEventListener('change', function() {
                          const manualRollInput = document.getElementById('manualRollInput');
                          if (this.checked) {
                            manualRollInput.style.display = 'block';
                          } else {
                            manualRollInput.style.display = 'none';
                          }
                        });

                        document.getElementById('plusAcc').addEventListener('click', () => {
                          let currentValue = parseInt(document.getElementById('modifierAcc').value, 10);
                          if (isNaN(currentValue)) currentValue = 0;
                          document.getElementById('modifierAcc').value = currentValue + 1;
                        });

                        document.getElementById('plusDiff').addEventListener('click', () => {
                          let currentValue = parseInt(document.getElementById('modifierAcc').value, 10);
                          if (isNaN(currentValue)) currentValue = 0;
                          document.getElementById('modifierAcc').value = currentValue - 1;
                        });
                      </script>`;

                    new Dialog({
                        title: "Downtime: Objective and Activity",
                        content: dialogContent,
                        buttons: {
                            Submit: {
                                label: "Submit Downtime Request",
                                callback: async (html2) => {
                                    let selectedTrigger = html2.find("#triggers")[0].value;
                                    let objective = html2.find("#objective")[0].value;
                                    let activity = html2.find("#activity")[0].value;
                                    let campaign = html2.find("#campaign")[0].value;
                                    let location = html2.find("#location")[0].value;
                                    let flatOverride = html2.find("#flatMod")[0].value;
                                    let accOverride = html2.find("#modifierAcc")[0].value;
                                    let staticOverride = html2.find("#staticOverride")[0].value;
                                    let flatOverrideNote = html2.find("#flatOverrideNote")[0].value;
                                    let modifierNote = html2.find("#modifierNote")[0].value;
                                    let staticOverrideNote = html2.find("#staticOverrideNote")[0].value;
                                    let manualRollEnabled = html2.find("#manualRoll")[0].checked;
                                    let manualRollValue = html2.find("#manualRollValue")[0].value;

                                    if (manualRollEnabled && !manualRollValue) {
                                        ui.notifications.warn("Manual Roll Mode is enabled but no value was entered. Please enter a dice result or disable Manual Roll Mode.");
                                        return;
                                    }

                                    let overrideRoll = false;

                                    let accRollTerm = 0;
                                    if (accOverride != 0) {
                                        accRollTerm = `${accOverride}d6k`;
                                    }
                                    let flatRollTerm = 0;
                                    if (flatOverride != 0) {
                                        flatRollTerm = flatOverride;
                                    }

                                    let selectedSkill = pilotData.skills.find(s => s.name === selectedTrigger);
                                    let skillRank = selectedSkill ? selectedSkill.rank : 0;

                                    let chatMessage = {
                                        speaker: {
                                            alias: pilotData.name
                                        },
                                        flavor: ''
                                    };

                                    let roll;
                                    let rollResult;
                                    let outcomeDesc;
                                    let rollString;

                                    let selectedAct = Activities.filter(act => act.Name === activity);

                                    if (outcomeDesc = selectedAct[0].Rollable === true) {
                                        if (manualRollEnabled && manualRollValue) {
                                            overrideRoll = true;
                                            rollResult = parseInt(manualRollValue);
                                            console.log(`Manual roll mode: Using physical dice result of ${rollResult}`);

                                            roll = await new Roll(rollResult.toString()).evaluate();
                                            chatMessage.rolls = roll;
                                        } else {
                                            if (flatOverride == 0 && accOverride == 0 && staticOverride == 0) {
                                                if (skillRank) {
                                                    rollString = `1d20 + ${2 * (skillRank)}`;
                                                } else {
                                                    rollString = `1d20`;
                                                }
                                            } else if ((flatOverride != 0 || accOverride != 0) && staticOverride == 0) {
                                                overrideRoll = true;
                                                if (skillRank) {
                                                    rollString = `1d20 + ${2 * (skillRank)} + ${flatRollTerm} + ${accRollTerm}`;
                                                    console.log(rollString);
                                                } else {
                                                    rollString = `1d20 + ${flatRollTerm} + ${accRollTerm}`;
                                                    console.log(rollString);
                                                }
                                            } else if (staticOverride != 0) {
                                                overrideRoll = true;
                                                rollString = staticOverride;
                                            }
                                            roll = await new Roll(rollString).evaluate();

                                            chatMessage.rolls = roll;

                                            rollResult = roll.total;
                                        }
                                    }

                                    let actOutcome = Activities.filter(obj => obj.Name == activity)[0].Results;

                                    if (!roll) {
                                        console.log('non-rollable activity');
                                        outcomeDesc = actOutcome;
                                        chatMessage.flavor = `${activity} : Success`;
                                        chatMessage.content = `${pilotData.name} downtime activity completed`;
                                        ChatMessage.create(chatMessage);
                                    } else {
                                        let outcome = actOutcome.filter(obj => obj.RollRange.includes(rollResult));
                                        outcomeDesc = outcome[0];
                                        chatMessage.flavor = `<p>${activity} : ${outcome[0].ShortDesc}</p>`;
                                        roll.toMessage(chatMessage);
                                    }

                                    let dialogContent = `
                                    <div style="margin: 1rem 0; padding: 1rem 1rem 0; background: white; border: 3px dashed black; font-family: monospace; max-height: calc(85vh - 120px); overflow-y: auto;">
                                        ${terms == 'diegetic' ? `<p style="margin-bottom: .5rem; margin-top: -10px; font-style:italic; font-size: 10px">Omninet session id: ${sessionId} <span style="color:green">(OPEN)</span></p>` : ''}
                                        <h2 class="lancer-border-primary">${pilotData.name}: Downtime Report</h2>
                                        ${terms == 'diegetic' ? '<p style="text-align:right; font-style:italic; font-size: 10px">All data indexed and analyzed by UAD ARGUS class NHP</p>' : ''}
                                        <br />
                                        <h3 class="lancer-border-primary" style="margin-bottom:1rem">${missionTermName}: <b>${campaign ? campaign : 'UNLISTED'}</b></h3>
                                        <div>
                                            <div style="border-left: 2px; border-left-style: dotted; border-color:var(--primary-color, fuschia); padding-left: .5rem;">
                                                <p style="margin-bottom:1rem"><b>${locationTermName}</b>: ${location ? location : '<i>unknown</i>'}</p>

                                                <p style="margin-bottom:1rem"><b>${activityTermName}</b>: ${activity}</p>

                                                <p style="margin-bottom:1rem"><b>${objectiveTermName}</b>: ${objective ? objective : '<i>null</i>'}</p>

                                                <p style="margin-bottom:1rem"><b>${skillTermName}</b>: ${selectedTrigger}</p>
                                                ${overrideRoll ? '<p class = "horus--subtle" style="color: red"><b>**ALERT:</b> OVERRIDE ENABLED<b>**</b></p>' : ''}
                                                <p style="margin-bottom:1rem"><b>${rollTermName}</b>: <span class="horus--subtle">${rollResult ? rollResult : 'NaN'}</span></p>
                                            </div>
                                            <p><b>${pilotNoteTermName}</b>: <i>${outcomeDesc["LongDesc"]}</i></p>
                                            <div style="font-style: italic; margin-left: 1rem; border-left: 2px; border-left-style: dotted; border-color:var(--primary-color, fuschia); padding-left: .5rem;">
                                                ${outcomeDesc["Info"] ? outcomeDesc["Info"] : '<br/>'}
                                            </div>
                                            <div id="overrideNotes">
                                                    ${manualRollEnabled && manualRollValue ? '<p style="border: 3px solid orange; background-color: rgba(255, 200, 100, 0.3); padding:.5rem; margin-top: .5rem;"><b>MANUAL ROLL MODE:</b> Physical dice result entered by player (' + manualRollValue + ')</p>' : ''}
                                                    ${flatOverrideNote && overrideRoll ? '<p style="border: 3px dashed cadetblue; background-color: #5f9ea070; padding:.5rem; margin-top: .5rem;"><b>Override Note:</b>' + flatOverrideNote + '</p>' : ''}
                                                    ${modifierNote && overrideRoll ? '<p style="border: 3px dashed cadetblue; background-color: #5f9ea070; padding:.5rem; margin-top: .5rem;"><b>Override Note:</b>' + modifierNote + '</p>' : ''}
                                                    ${staticOverrideNote && overrideRoll ? '<p style="border: 3px dashed cadetblue; background-color: #5f9ea070; padding:.5rem; margin-top: .5rem;"><b>Override Note:</b>' + staticOverrideNote + '</p>' : ''}
                                            </div>
                                            <br />
                                            <h3 class="lancer-border-primary">Downtime Activity Complete.</h3>
                                            <div style="margin-bottom:1rem">
                                                <p><i>Record any resultant outcomes or consequences, if applicable.</i></p>
                                                <textarea placeholder="A brief summary of results, general analysis of success or failure, and potential next steps to continue on trajectory towards any goals or project completions" style="display:inline; width: 100%; height: 100px; background-color: transparent; border: 1px #00000085 solid; border-radius: 3px;" id="pilotEvaluate"></textarea>
                                            </div>
                                            <p style="text-align:center; padding-top:.5rem;"> --- OR --- </p>
                                            <label for="default_override">Static Override Value: </label><input id="staticOverride" style="width:60px;" name="default_override" placeholder="1-100" type="number" min="1" max="100">
                                            <textarea placeholder="Full override, bypasses Probability matrices. Precognitive bandwidth may exceed administrative NHP allotment. Use sparingly. Add notes for ingestion by Evaluatory COMP/CON." style="display:inline; width: 100%; height: 50px; background-color: transparent; border: 1px #00000085 solid; border-radius: 3px;margin-top:5px;" type="text" id="staticOverrideNote"></textarea>
                                        </div>
                                    </div>
                                `;
                                    new Dialog({
                                        title: "Downtime: Summary",
                                        content: dialogContent,
                                        buttons: {
                                            submitClose: {
                                                label: "Submit and Close"
                                            },

                                            logToJournal: {
                                                label: "Log Downtime in Journal",
                                                callback: async (html3) => {
                                                    if (JournalEntry.canUserCreate(game.user) == false) {
                                                        ui.notifications.error(
                                                            `${game.user.name} attempted to write Downtime Activity to Downtime Journal. Please correct and try again.`
                                                        );
                                                        return;
                                                    } else {
                                                        const journalFolderName = "Downtime Journal";

                                                        let journalFolder = game.folders.getName(journalFolderName);

                                                        if (!journalFolder && journalFolderName.length > 0) {

                                                            console.log('Attempting to create new Downtime Journal Folder');

                                                            try {
                                                                journalFolder = await Folder.create({
                                                                    name: journalFolderName,
                                                                    type: "JournalEntry",
                                                                });
                                                            } catch (error) {
                                                                ui.notifications.error(
                                                                    `${journalFolderName} does not exist and must be created manually by a user with permissions to do so.`
                                                                );
                                                                return;
                                                            }
                                                        }

                                                        let downtimeJournal = {};

                                                        downtimeJournal.name = `Downtime_Journal.LOG//${(pilotData.name).replaceAll(' ', '-')}`;
                                                        downtimeJournal.folder = game.folders.getName(journalFolderName)._id;

                                                        if (!game.journal.getName(`Downtime_Journal.LOG//${(pilotData.name).replaceAll(' ', '-')}`)) {

                                                            console.log('Attempting to create new Downtime Journal for Pilot');

                                                            try {
                                                                createJournal = await JournalEntry.create(downtimeJournal);
                                                            } catch (error) {
                                                                ui.notifications.error(
                                                                    `Error creating Journal`
                                                                );
                                                                return;
                                                            }
                                                        }

                                                        let pilotEvaluate = html3.find("#pilotEvaluate")[0].value;

                                                        let JournalPageContent = `
                                                        <div style="margin: 1rem 0; padding: 1rem 1rem 0; background: white; border: 3px dashed black; font-family: monospace; max-width: 800px;">
                                                        ${terms == 'diegetic' ? `<p style="margin-bottom: .5rem; margin-top: -10px; font-style:italic; font-size: 10px">Omninet session id: ${sessionId} <span style="color: red;">(CLOSED)</span></p>` : ''}
                                                        <h2 class="lancer-border-primary">${pilotData.name}: Downtime Report</h2>
                                                        ${terms == 'diegetic' ? '<p style="text-align:right; font-style:italic; font-size: 10px">All data indexed and analyzed by UAD ARGUS class NHP</p>' : ''}
                                                        <br />
                                                        <h3 class="lancer-border-primary" style="margin-bottom:1rem">${missionTermName}: <b>${campaign ? campaign : 'UNLISTED'}</b></h3>
                                                        <div>
                                                            <div style="border-left: 2px; border-left-style: dotted; border-color:var(--primary-color, fuschia); padding-left: .5rem;">
                                                                <p style="margin-bottom:1rem"><b>${locationTermName}</b>: ${location ? location : '<i>unknown</i>'}</p>

                                                                <p style="margin-bottom:1rem"><b>${activityTermName}</b>: ${activity}</p>

                                                                <p style="margin-bottom:1rem"><b>${objectiveTermName}</b>: ${objective ? objective : '<i>null</i>'}</p>

                                                                <p style="margin-bottom:1rem"><b>${skillTermName}</b>: ${selectedTrigger}</p>
                                                                ${overrideRoll ? '<p class = "horus--subtle" style="color: red"><b>**ALERT:</b> OVERRIDE ENABLED<b>**</b></p>' : ''}
                                                                <p style="margin-bottom:1rem"><b>${rollTermName}</b>: <span class="horus--subtle">${rollResult ? rollResult : 'Indeterminate'}</span></p>
                                                            </div>
                                                            <p><b>${pilotNoteTermName}</b>: <i>${outcomeDesc["LongDesc"]}</i></p>
                                                            <div style="font-style: italic; margin-left: 1rem; border-left: 2px; border-left-style: dotted; border-color:var(--primary-color, fuschia); padding-left: .5rem;">
                                                                ${outcomeDesc["Info"] ? outcomeDesc["Info"] : '<br/>'}
                                                            </div>
                                                            <div id="overrideNotes">
                                                                ${flatOverrideNote && overrideRoll ? '<p style="border: 3px dashed cadetblue; background-color: #5f9ea070; padding:.5rem; margin-top: .5rem;"><b>Override Note:</b>' + flatOverrideNote + '</p>' : ''}
                                                                ${modifierNote && overrideRoll ? '<p style="border: 3px dashed cadetblue; background-color: #5f9ea070; padding:.5rem; margin-top: .5rem;"><b>Override Note:</b>' + modifierNote + '</p>' : ''}
                                                                ${staticOverrideNote && overrideRoll ? '<p style="border: 3px dashed cadetblue; background-color: #5f9ea070; padding:.5rem; margin-top: .5rem;"><b>Override Note:</b>' + staticOverrideNote + '</p>' : ''}
                                                            </div>
                                                            <br />
                                                            <div style="margin-bottom:1rem">
                                                                <h3 class="lancer-border-primary">NET ASSET REPORT</h3>
                                                                <p><b>${outcomeTermName}</b>:</p>
                                                                <div style="border-left: 2px; border-left-style: dotted; border-color:var(--primary-color, fuschia); padding-left: .5rem;">${pilotEvaluate ? pilotEvaluate : '<i>No Pilot Evaluation</i>'}</div>
                                                            </div>
                                                            <div style="margin-bottom: 1rem;">
                                                                <h3 style="border:none;">Requisitions Evaluation</h3>
                                                                <p style="font-size:10px;" class="horus--subtle"><i>${gmNoteTermName}</i></p>
                                                                <div style="min-height: 100px; border: 5px dashed cadetblue; background-color: #5f9ea070">
                                                                    <p style="margin: 1rem"><i>Enter evaluated asset losses or requisitions here. Include personnel assets, liquid assets, organization or institutional assets, and physical assets garnered from this activity. Also include intelligence on tracked projects (if applicable)${terms == 'diegetic' ? ' for classification by UAD Predictive Model NHPs.' : '.'}</i></p>
                                                                </div>
                                                            </div>
                                                        </div>
                                                        <div style="text-align: right;"><img style="margin-right: -1rem; margin-bottom: -.25rem; height:20px; border: none; position:relative" src="systems/lancer/assets/faction-logos/union.svg"></div>
                                                    </div>
                                                    `;

                                                        let parentdata = {
                                                            parent: game.journal.filter(a => a.name == downtimeJournal.name)[0]
                                                        };

                                                        selectedJournal = game.journal.filter(a => a.name === downtimeJournal.name)[0];

                                                        let journalEntryNumber = selectedJournal.pages.size + 1;

                                                        let newPageName = `DOWNTIME-ENTRY.${journalEntryNumber}//${(pilotData.name).replaceAll(' ', '-')}`;

                                                        console.log('making a new page called ' + newPageName);

                                                        let entrydata = {
                                                            name: newPageName,
                                                            type: "text",
                                                            text: {
                                                                content: JournalPageContent
                                                            }
                                                        };

                                                        console.log("Creating a final downtime report");

                                                        const createPage = await JournalEntryPage.create(entrydata, parentdata);
                                                    }
                                                }
                                            }
                                        }
                                    }, { width: 600, height: "auto" }).render(true);
                                }
                            }
                        }
                    }, { width: 800, height: "auto", resizable: true }).render(true);
                }
            }
        },
        default: "submit"
    }, { width: 500, height: "auto" }).render(true);
}
