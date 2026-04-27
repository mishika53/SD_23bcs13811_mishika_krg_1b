
interface SocialMedia {
    void chat(String message);
}


interface Postable {
    void post(String content);
}


interface StoryFeature {
    void addStory(String story);
}


class WhatsApp implements SocialMedia, StoryFeature {
    public void chat(String message) {
        System.out.println("WhatsApp chat: " + message);
    }

    public void addStory(String story) {
        System.out.println("WhatsApp story: " + story);
    }
}

class Facebook implements SocialMedia, Postable, StoryFeature {
    public void chat(String message) {
        System.out.println("Facebook chat: " + message);
    }

    public void post(String content) {
        System.out.println("Facebook post: " + content);
    }

    public void addStory(String story) {
        System.out.println("Facebook story: " + story);
    }
}

class Instagram implements SocialMedia, Postable, StoryFeature {
    public void chat(String message) {
        System.out.println("Instagram chat: " + message);
    }

    public void post(String content) {
        System.out.println("Instagram post: " + content);
    }

    public void addStory(String story) {
        System.out.println("Instagram story: " + story);
    }
}
public class lld {
    public static void main(String[] args) {
        SocialMedia app1 = new WhatsApp();
        SocialMedia app2 = new Facebook();

        app1.chat("Hello from WhatsApp");
        app2.chat("Hello from Facebook");

        Postable fb = new Facebook();
        fb.post("FB Post");

        Postable ig = new Instagram();
        ig.post("IG Post");
    }
}