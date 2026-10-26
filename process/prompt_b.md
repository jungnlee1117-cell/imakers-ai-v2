당신은 어린이 체육 수업 코치입니다. 아래 전사본(음성인식 결과)으로 선생님의 수업 코칭 카드 내용을 만드세요.

## 규칙
1. 점수·순위·등급을 만들지 않는다. 잘한 장면과 "이렇게 해 보면 좋은 장면"을 구체적으로 쓴다. 훈육은 잘함/못함이 아니라 제안으로 쓴다.
2. 전사본은 음성인식 결과라 틀릴 수 있다. "<<믿기 어려운 줄>>"은 평가에 쓰지 않는다. 들리는 것만으로 판단하고 추측하지 않는다.
3. 같은 소리의 영어(your/you're, knee/knees)는 문장 오류로 세지 않는다.
4. 아이 이름은 이미 [아이]로 가려져 있다. 출력에도 아이 이름을 쓰지 않는다.
5. 시각은 초(정수). 장면에는 전사본에 실제로 있는 시각만 쓴다.
6. 말투: 선생님을 존중하는 존댓말. 한 문장 25단어 이내.
7. language_mode 가 english 일 때만 english_phrases 를 쓴다. type: error=확실한 문장 오류, tip=더 쉽게 말하는 다듬기 제안, check=음성인식 의심.

## 수업 정보
{"date": "2026-08-25", "class_name": "수업 B", "sport": "soccer", "language_mode": "english", "duration_sec": 1527, "source": "video", "teacher_names": ["Rachel"]}

## 코드가 이미 센 것 (참고만, 다시 세지 말 것)
- 칭찬 표현: Excellent!, Good job!, Well done!
- 규칙을 질문으로 안내한 횟수: 6

## 출력 (JSON 하나만, 설명 없이)
{
 "flow": {"note": "수업 흐름에 대한 한두 문장", "segments": [{"start_sec": 0, "end_sec": 145, "label": "...", "kind": "main|normal|control"}]},
 "english_phrases": {"note": "...", "items": [{"at_sec": 0, "heard": "...", "suggested": "...", "reason": "...", "type": "error|tip|check"}]},
 "interaction": {"good": [{"title": "...", "at_sec": [0], "text": "..."}], "improve": [{"title": "...", "at_sec": [0], "text": "..."}]},
 "child_care_expressions": [{"expression": "...", "at_sec": 0}],
 "practice": [{"id": "s1", "say": "...", "why": "...", "is_task": false}],
 "extra_excluded": [{"at_sec": 0, "reason": "..."}],
 "wait_segments": 0,
 "question_segments": 0
}
- segments 는 처음(0초)부터 마지막까지 빈틈 없이 이어 쓴다. kind: main=아이들이 움직인 활동, normal=설명·준비·정리, control=훈육·재정비.
- interaction.good 3~5개, improve 2~3개. practice 3~4개(마지막 하나는 수업 뒤 체크하는 과제여도 좋다).
- child_care_expressions: 아이 상태를 묻거나 기분을 받아 주거나 기다릴 시간을 알려 주는 말(전사본에 있는 그대로).
- wait_segments: 같은 대기·정지 지시가 반복된 구간 수. question_segments: 아이 반응을 끌어낸 질문 구간 수.

## 전사본
[0:00] It's Friday!
[0:06] Let me see who's in 9th
[0:11] I'm gonna give you guys your peas.
[0:15] It is one, two, three.
[0:20] Okay. Five, nine.
[0:29] No, 9, 10, okay 10.
[0:34] I thought you got, there's only nine, 10, six. What do you see?
[0:41] Thank you when you get to penis from me you have to say thank you  <<믿기 어려운 줄: 평가에 쓰지 말 것>>
[0:47] Oh yes, [아이]. Thank you. Thank you.
[0:55] Say, "Thank you."
[1:00] Thank you!
[1:05] [아이], [아이] (…반복)
[1:09] And the end Put them on nicely Come here
[1:19] Oh, [아이], no screaming.
[1:28] Calm down.
[1:32] Wrong hole. This one, this one.
[1:39] (children laughing)  <<믿기 어려운 줄: 평가에 쓰지 말 것>>
[1:45] (laughing)  <<믿기 어려운 줄: 평가에 쓰지 말 것>>
[1:47] Set up!
[1:49] Sit down.
[1:52] (children laughing)  <<믿기 어려운 줄: 평가에 쓰지 말 것>>
[2:01] Get your feet!
[2:14] Oh.
[2:18] Sorry, sorry. Picture first.
[2:23] Um...
[2:25] Shit.  <<믿기 어려운 줄: 평가에 쓰지 말 것>>
[2:31] Okay, one ball each, go, one ball each. No running, no (…반복) running, one ball each. One ball each. One ball each. Okay, everyone sit down, go back to your seat 10, nine, eight, seven, six, five.
[2:54] Oh, silly nice, eh?
[2:58] (children shouting)  <<믿기 어려운 줄: 평가에 쓰지 말 것>>
[3:02] [아이], too squishy. Who's in the bathroom now?
[3:10] Okay, let's see
[3:16] What color is this? Blue. What color is this?
[3:24] Who likes purple? I like blue. Blue? Oh you like blue? Who likes green?
[3:33] I like the house!
[3:35] (baby crying
[3:37] 1, 2, 3
[3:40] bubbles in your mouth. I know you guys are excited, but...
[3:44] Now is not the time for you to talk. Ms. Rachel has to talk, okay? Who's ready? Show me two thumbs up. Who's ready? - It's me. - [아이], calm down, please. Okay. Do you see the circles?
[3:57] We've done this before. So in every circle, you have to touch the ball four times. One, two, three, four, and move to a different circle. One, two, three, and four, move to a different circle. Understand? You need to go to 10 circles in total. How many?
[4:19] Okay, I will stand up.
[4:22] Can you go too fast? No. Okay, let's go.
[4:33] Tap four times.
[4:38] Four times.
[4:48] two, three, four, and move. Come on, meet. Go find a different circle. Go look for a different circle.
[5:03] One, two, three.
[5:07] Excellent! One more time! One, two, three, four! One, two, three, four!
[5:32] Yes, let's go! 1, 2, 3, 4!
[5:36] Okay, everyone stop please don't move hands on your head
[5:42] Head, shoulders, a ball's on the floor. Head, shoulders, knees, ball. Good. Put it down, head, shoulders, head, shoulders, knees, clap, ball.
[6:00] Head, shoulders.
[6:04] Knees, head, ears, eyes, nose, mouth. Full.
[6:12] All your dance, shoot!
[6:14] I want everyone to line up behind me. Line up behind me. Okay.
[6:23] Penguin, right, yeah, right. Penguin, penguin, around the track, okay? Inside, inside (…반복). You can start. No, [아이] go back. [아이] go back.
[6:36] You can start when your friend gets to the green circle, okay? Ready, go! [아이], go!
[6:45] You can start when your friend gets you the drink, [아이].
[6:51] wait when he gets to green circle you can go wait wait no no you have to wait when he's at the green circle you can go
[7:05] - [Girl]
[7:09] Penguin, Penguin!
[7:13] Come on, [아이]. Inside, inside. Ping-a-ping-a-ping. Wait, let's go, let's go. Ping-a-ping-a-ping. Wait. You gotta wait, you gotta wait. [아이], you have to wait. [아이], wait. Look at the way, look at the way.
[7:30] - Yes!
[7:32] Dinosaur! Wait, [아이], wait. Show me what you got, [아이]. Hey, go behind this [아이]. What are you doing? Go!
[7:43] Inside, inside, let's go mini mini Move your feet mini
[7:54] I
[8:02] Okay, how's that? Okay, this time the ball has to go between my legs. Okay, [아이]? Now roll the ball through my legs. Roll it through my legs.
[8:15] and then go around me. Go. Penguins, penguins, okay? [아이], roll the ball through my legs. Roll it through my legs, kick it. Kick, kick, and then go. Good. Go, shoot. No, not too hard, shoot. Go get it, not too hard, not too hard, go. Come on, [아이].
[8:36] Balls between my legs, not too hard. Nothing, try again. Between my legs, good. Between my legs, not too hard. Gentle, gentle pass. Good job, [아이]. Well done. Well done, [아이]. Between my legs.
[8:58] It's been my leg, go (…반복).
[9:04] Go (…반복)! Let's go! [아이]!
[9:24] Not too hard. Try again. Go, go, go. Kick it. Go around me. Around me. Around me.
[9:43] around me, good kick it, no with your feet please use your feet please use your feet
[10:00] Okay, attention!
[10:04] Come to miss Rachel walking walking balls away in the bag in the bag not in the jail in the bag in the bag Everyone let's clean up the circles game time game time Thank you game ball
[10:27] [아이], [아이], ball here.
[10:33] I'll see you in the next video.  <<믿기 어려운 줄: 평가에 쓰지 말 것>>
[11:02] (baby crying)  <<믿기 어려운 줄: 평가에 쓰지 말 것>>
[11:08] Okay, let's see who wants to go first? I want to go
[11:14] Oh, my!
[11:19] I don't know if you can go first or not. I don't know. Clap three times! One, two, three. Tap on your head. One, two, three. Is this broken? This must be broken.
[11:32] What?
[11:35] No kidding. Oh, here. It's not broken.
[11:40] No kidding.
[11:43] Sorry?
[11:45] tape? You need tape? Oh, you sure? Yeah. Thank you. I'll be great.
[11:52] Thanks.
[11:56] Oh. (clapping)
[12:01] Thank you, man.
[12:07] (upbeat music)  <<믿기 어려운 줄: 평가에 쓰지 말 것>>
[12:11] (clapping)  <<믿기 어려운 줄: 평가에 쓰지 말 것>>
[12:14] 3B3, okay? I'm gonna choose 3 from the green team, 3 from the purple team. Team purple. Let's have...
[12:23] Sheer, [아이], [아이], go, purple. [아이], [아이], and [아이]. You four in the corner, let's go. Come here, [아이]. How do you? [아이], how do you look?
[12:40] Bye!
[12:45] (crash)  <<믿기 어려운 줄: 평가에 쓰지 말 것>>
[12:50] Sit down. You're gonna go back in two minutes, okay? You're gonna play it in two minutes. Sit.
[13:04] Are you ready?
[13:07] Oh, nobody's ready. Are you ready? Yeah.
[13:12] Can you do it?
[13:17] Okay, here we go. Can you push your friends?
[13:21] Can you cut the line?
[13:23] Sorry, not cut the line. Can you cut in front of your friend? No. Can you use your hands and pick up the ball like this? My ball. No. Can you throw the ball? No. Can you slide tackle and go on your legs like this, on your knees? No slide tackling, okay?
[13:43] Ready?
[14:08] (children shouting)  <<믿기 어려운 줄: 평가에 쓰지 말 것>>
[14:17] (screaming)  <<믿기 어려운 줄: 평가에 쓰지 말 것>>
[14:26] Careful!
[14:39] Oh careful
[14:59] (baby crying)  <<믿기 어려운 줄: 평가에 쓰지 말 것>>
[15:04] Okay, okay, okay.
[15:08] (screaming)  <<믿기 어려운 줄: 평가에 쓰지 말 것>>
[15:14] Bye!
[15:18] Okay, shut up!  <<믿기 어려운 줄: 평가에 쓰지 말 것>>
[15:24] here is a switch
[15:32] Me here, you don't want to play
[15:35] Let's go meet him. They need your help. Let's have [아이] one more time. [아이] go over there. [아이], let's have [아이] one more time. [아이] go.
[15:50] There you go, Miss [아이] on purple team.
[15:55] Play!
[16:15] (children laughing) (children shouting) (children (…반복) shouting)
[16:35] Oh, oh (…반복),
[16:56] Careful, careful. No hands, [아이], no hands. Only for your feet, only your feet.
[17:04] (screaming)  <<믿기 어려운 줄: 평가에 쓰지 말 것>>
[17:09] (children shouting)  <<믿기 어려운 줄: 평가에 쓰지 말 것>>
[17:29] Careful, no hands (…반복). (screaming)
[17:38] (children cheering)  <<믿기 어려운 줄: 평가에 쓰지 말 것>>
[17:45] I'm coming!
[17:51] (children shouting)  <<믿기 어려운 줄: 평가에 쓰지 말 것>>
[17:56] (children shouting) (children (…반복) shouting)
[18:16] Okay, switch. Let's go switch.
[18:27] Switch. Yeah, let's see.
[18:36] Let's have...
[18:39] [아이], one more time, [아이].
[18:42] [아이], let's have [아이] one more time.
[18:53] Ready?
[18:55] (upbeat music)  <<믿기 어려운 줄: 평가에 쓰지 말 것>>
[18:59] Look up, look up, look up.
[19:11] Careful, no hands, you. No hands. Careful. Come out there (…반복).
[19:36] (children shouting) (children shouting)  <<믿기 어려운 줄: 평가에 쓰지 말 것>>
[19:49] Careful! Oh, careful, careful.
[20:10] (baby crying)  <<믿기 어려운 줄: 평가에 쓰지 말 것>>
[20:14] (children shouting)  <<믿기 어려운 줄: 평가에 쓰지 말 것>>
[20:31] I don't have a dribble, I've got a dribble.
[20:36] (upbeat music)  <<믿기 어려운 줄: 평가에 쓰지 말 것>>
[20:42] (man speaking in foreign language)  <<믿기 어려운 줄: 평가에 쓰지 말 것>>
[20:49] Play, play, play.
[21:03] You can't get away!
[21:07] You can't do it! He can't do it!
[21:15] Let's go, P!
[21:20] (children shouting)  <<믿기 어려운 줄: 평가에 쓰지 말 것>>
[21:25] (children shouting)  <<믿기 어려운 줄: 평가에 쓰지 말 것>>
[21:40] Okay switch switch go (…반복) switch
[21:51] I'm John ready
[21:56] Wait, did you switch yet? You just wait wait, who was just sitting down? Who was just sitting down?
[22:06] You three, right? [아이], you play.
[22:09] Right? And...
[22:14] Once the tub
[22:17] [아이] one more time. And [아이] one more time.
[22:28] (screaming)  <<믿기 어려운 줄: 평가에 쓰지 말 것>>
[22:34] Let's try it.
[22:39] 고고~
[22:41] (children cheering)  <<믿기 어려운 줄: 평가에 쓰지 말 것>>
[22:47] (children screaming)  <<믿기 어려운 줄: 평가에 쓰지 말 것>>
[22:50] Careful
[23:04] Go ahead!
[23:15] (children shouting)  <<믿기 어려운 줄: 평가에 쓰지 말 것>>
[23:30] (children shouting)  <<믿기 어려운 줄: 평가에 쓰지 말 것>>
[23:37] (siren wailing)  <<믿기 어려운 줄: 평가에 쓰지 말 것>>
[23:40] (upbeat music
[23:45] (children shouting)  <<믿기 어려운 줄: 평가에 쓰지 말 것>>
[23:58] Okay, okay, shit!  <<믿기 어려운 줄: 평가에 쓰지 말 것>>
[24:06] Take off your pinis. No more talking. Take off your pinis. Take off your pinis. Put them nicely over here. No. Clean up time (…반복)
[24:26] Finish off! Finish off!
[24:30] Oh, no, just go. Here. Nicely. Inside out, that's inside out. Nicely. Out, nicely. Yes. No, don't put it away inside out, okay? Nicely, please. To Ms. Rachel.
[24:51] Next here, [아이], no thank you. (speaking in foreign language) - Nicely to miss Rachel, sorry. Oh, nicely to miss Rachel. Everyone line up, change your shoes. Now call change your shoes. Let's call change your shoes.
[25:15] I got it thank you [아이] thank you let me cut let me cut
