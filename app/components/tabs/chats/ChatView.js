import React, { Component } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableHighlight,
  Image,
  Alert
} from 'react-native';

import { connect } from 'react-redux';
import { switchTab, loadMessages, setLatestMessage, uploadImage, createChat, MESSAGE_SIZE } from 's5-action';
import { S5Header, S5Alert, S5Drawer, S5Icon } from 's5-components';

import ControlPanel from './ControlPanel';

import { GiftedChat, Bubble, Send, Composer } from 'react-native-gifted-chat';

import SocketIO from 'react-native-socketio';

import { leaveChat } from 's5-action';

var ImagePicker = require('react-native-image-picker');

var imagePickerOptions = {
  title: 'Select Image',
  quality: 0.5,
  storageOptions: {
    skipBackup: true,
    path: 'images'
  }
};

class ChatView extends Component {

  static propTypes = {
    chat: React.PropTypes.object,
    user: React.PropTypes.object.isRequired,
    users: React.PropTypes.array,
    navigator: React.PropTypes.object.isRequired,
    setLatestMessage: React.PropTypes.func.isRequired,
    loadMessages: React.PropTypes.func.isRequired,
    switchTab: React.PropTypes.func.isRequired,
    createChat: React.PropTypes.func.isRequired,
  };

  constructor(props) {

    super(props);

    this.state = {
      messages:     [],
      loadEarlier:  false,
      lastLoadedAt: null,
      isTyping:     null,
      connected:    false,
      node:         {},
      chat:         props.chat ? props.chat : { users: props.users },
      menuOpened:   false,
    };

    this.onSend             = this.onSend.bind(this);
    this.renderBubble       = this.renderBubble.bind(this);
    this.renderFooter       = this.renderFooter.bind(this);
    this.renderComposer     = this.renderComposer.bind(this);
    this.renderSend         = this.renderSend.bind(this);
    this.onLoadEarlier      = this.onLoadEarlier.bind(this);

    this.openControlPanel   = this.openControlPanel.bind(this);
    this.closeControlPanel  = this.closeControlPanel.bind(this);
    this.openMenu           = this.openMenu.bind(this);
    this.closeMenu          = this.closeMenu.bind(this);
    this.selectImage        = this.selectImage.bind(this);
    this.sendMesage         = this.sendMesage.bind(this);

    this.initChannelNodeServer = this.initChannelNodeServer.bind(this);
    this._addUserCallback = this._addUserCallback.bind(this);
    this._leaveChat = this._leaveChat.bind(this);

  }

  componentWillMount() {  // or componentDidMount ?

    if(this.state.chat.channelId) {

      // Load Messages from session-server
      this.props.loadMessages(this.state.chat).then(
        (result) => {

          if(result.messages.length > 0) {

            this.setState({
              messages: result.messages,
              loadEarlier: result.messages.length == MESSAGE_SIZE ? true : false,
              lastLoadedAt: result.messages[ result.messages.length - 1 ].createdAt,
            });

            // set latest message !
            this.props.setLatestMessage(this.state.chat.channelId, result.messages[0].text);

          }

          this.initChannelNodeServer(result.node, this.state.chat.channelId);

        },
        (error) => {
          console.warn(error);
          this.refs['alert'].alert('error', 'Error', 'an error occured, please try again late');
        }
      );
    }

  }

  initChannelNodeServer(node, channelId, callback) {

    this.setState({
      node: node
    });

    var socketConfig = {
      nsp: '/channel',
      forceWebsockets: true,
      connectParams: {
        A: node.app,
        S: node.name,
        C: channelId,
        U: this.props.user.id,
        // D: Device ID !! ???
      }
    };

    if(this.socket) { this.socket = null; }

    this.socket = new SocketIO(node.url, socketConfig);

    this.socket.on('connect', () => { // SOCKET CONNECTION EVENT
      this.setState({ connected: true }, () => {

        if(callback) callback();
      });
    });

    this.socket.on('error', () => { // SOCKET CONNECTION EVENT
      this.setState({ connected: false });
    });

    this.socket.on('connect_error', (err) => { // XPUSH CONNECT ERROR EVENT
      console.warn(err);
    });

    this.socket.on('_event', (data) => { // XPUSH EVENT
      console.log('[_EVENT]', data);
    });

    let self = this;
    this.socket.on('message', (message) => { // MESSAGED RECEIVED
      console.log('------ 받음 - ', message);
      this.setState((previousState) => {

        // set latest message !
        self.props.setLatestMessage(self.state.chat.channelId, message[0].text);

        return { messages: GiftedChat.append(previousState.messages, message) };
      });
    });

    this.socket.onAny((event) => {
      console.log('[LOGGING]', event);
    });

    this.socket.on('sent', (data) => { // after sent a messeage.
      console.log('[SENT]', data);
    });

    this.socket.connect();

  }

  componentWillUnmount() {
    if(this.socket) {
      this.socket.disconnect();
    }
  }

  closeControlPanel(action) {
    var self = this;
    this._drawer.close();
    if( action ){
      if( action.openSelectUserView){
        this.props.navigator.push({selectUserView: 1, chat:this.state.chat, callback:this._addUserCallback});
      } else if( action.leaveChat && self.state.chat && self.state.chat.id ){

        Alert.alert(
          'Alert Title',
          'Do you want leave?',
          [
            {text: 'Leave', onPress: () => self._leaveChat(self.state.chat.id)},
            {text: 'Cancel', onPress: () => console.log('Cancel Pressed!')},
          ]
        )
      }
    }
  }

  _leaveChat(chatId){
    this.props.leaveChat(chatId).then(() => {
      this.props.navigator.pop();
    });
  }

  _addUserCallback(type, data){
    if( type =='A' ){
      this.setState( {chat:data} );
      this.props.navigator.pop();
    } else if ( type =='C' ){
      // 신규생성
      this.props.navigator.pop();
      this.props.navigator.replace({
        chatView: true,
        users:data
      });
    }
  }

  openControlPanel() {
    this._drawer.open()
  }

  openMenu(){
    this.setState({ menuOpened: true });
    this.selectImage();
  }

  closeMenu(){
    this.setState({ menuOpened: false });
  }

  selectImage(){

    var self = this;
    ImagePicker.showImagePicker(imagePickerOptions, (response) => {

      // TODO 맨 처음 이미지를 보내는 경우 (socket 이 연결 안된 경우) channelID 를 모르기 때문에 아래 동작은 정상 적으로 되지 않음. 이부분 어떻게 고쳐야 멋질까?
      if (response.didCancel) {
        this.closeMenu();
        console.log('User cancelled photo picker');
      } else if (response.error) {
        console.log('ImagePicker Error: ', response.error);
      } else if (response.customButton) {
        console.log('User tapped custom button: ', response.customButton);
      } else {
        var data = {
          C : this.state.chat.channelId,
          U : this.props.user.id,
          imgBase64 : response.data
        };

        uploadImage(data, function(err, result){

          if( self.state.connected ) {
            var message = {
              image: result,
              user: { _id: self.props.user.id },
              createdAt: new Date(),
              _id: 'temp-id-' + Math.round(Math.random() * 1000000)
            };

            self.sendMesage(message);

          }

          self.closeMenu();
        });
      }
    });
  }

  onLoadEarlier() {

    // Load Message earlier messages from session-server.
    this.props.loadMessages(this.state.chat, this.state.lastLoadedAt).then( (result) => {

      if(result.messages.length > 0) {
        this.setState((previousState) => {

          return {
            messages: GiftedChat.prepend(previousState.messages, result.messages),
            loadEarlier: result.messages.length == MESSAGE_SIZE ? true : false,
            lastLoadedAt: result.messages[ result.messages.length - 1 ].createdAt,
          };
        });
      }

    });
  }

  onSend(messages = []) {

    //console.log(this.socket, this.state.connected, this.state.chat.channelId, ((this.socket && this.state.connected) || !this.state.chat.channelId));

    if ( (this.socket && this.state.connected) || !this.state.chat.channelId ){
      this.sendMesage(messages[0]);
    }

  }

  sendMesage(message){
    console.log(message);

    message.createdAt = Date.now();

    if( this.socket ) {
      this.socket.emit('send', {NM:'message', DT: message});

    } else {

      this.props.createChat(this.state.chat.users).then(
        (result) => {

          console.log('CREATED CHAT!!!', result);

          this.setState({ chat: result.chat });
          var self = this;
          this.initChannelNodeServer(result.node, result.chat.channelId, () => {
            self.socket.emit('send', {NM:'message', DT: message });
          });
        },
        (error)=> {
          console.log('ERROR....>', error);
          // TODO Channel 데이터는 생성했지만, Channel 서버를 할당받지 못한 상태 (Channel 서버가 실행되어 있지 않은 경우) 처리 필요.
          this.refs['alert'].alert('error', 'Error', 'an error occured, please try again late');
        });

    }

  }

  renderBubble(props) {
    return (
      <Bubble
        {...props}
        wrapperStyle={{
          left: {
            backgroundColor: '#f0f0f0',
          }
        }}
      />
    );
  }

  renderFooter(props) {
    if (this.socket && this.socket.isConnected && !this.state.connected) {
      return (
        <View style={styles.footerContainer}>
          <Text style={styles.footerText}>
            Connection was failed. Reconnecting...
          </Text>
        </View>
      );
    }
    return null;
  }


  renderComposer(props){
    return (
      <View style={styles.composer}>
        {this.renderMenu()}
        <Composer {...props}/>
      </View>
    );
  }

  renderMenu(props){
    if( this.state.menuOpened ){
      return (
        <S5Icon name={'close'} color={'gray'} onPress={this.closeMenu} style={styles.menuIcon}/>
      );
    } else {
      return (
        <S5Icon name={'add'} color={'gray'} onPress={this.openMenu} style={styles.menuIcon}/>
      );
    }
  }

  renderSend(props) {
    if ( this.state.connected || !this.state.chat.channelId ) {
      return (
        <Send {...props}/>
      );
    }
    return null;
  }

  onCloseAlert() {

  }

  render() {

    const leftItem = {
      title: 'backup',
      icon: 'arrow-back',
      onPress: () => {
        this.props.switchTab();
        this.props.navigator.pop();
      },
    };

    const rightItem = {
      title: 'menu',
      icon: 'menu',
      onPress: () => this.openControlPanel(),
    };

    return (
      <View style={styles.container}>
      <S5Drawer
        type="overlay"
        content={<ControlPanel closeDrawer={this.closeControlPanel} users={this.state.chat.users} navigator={this.props.navigator} />}
        ref={(ref) => this._drawer = ref}
        tapToClose={true}
        openDrawerOffset={0.2} // 20% gap on the right side of drawer
        side="right"
        panCloseMask={0.2}
        closedDrawerOffset={-3}
        styles={{main: {shadowColor: '#000000', shadowOpacity: 0.8, shadowRadius: 15}}}
        tweenHandler={(ratio) => ({
          main: { opacity:(2-ratio)/2 }
        })}
        >
          <S5Header
            title="Chats"
            style={{backgroundColor: '#224488'}}
            leftItem={{...leftItem, layout: 'icon'}}
            rightItem={{...rightItem, layout: 'icon'}}
          />

          <GiftedChat
            messages={this.state.messages}
            onSend={this.onSend}
            loadEarlier={this.state.loadEarlier}
            onLoadEarlier={this.onLoadEarlier}

            user={{
              _id: this.props.user.id, // sent messages should have same user._id
            }}

            renderBubble={this.renderBubble}
            renderFooter={this.renderFooter}
            renderSend={this.renderSend}
            renderComposer={this.renderComposer}

            textInputProps={{
              editable: ( this.state.connected || !this.state.chat.channelId ),
            }}
          />
        </S5Drawer>

        <S5Alert ref={'alert'} />

      </View>
    );
  }
}

const styles = StyleSheet.create({
	container: {
		backgroundColor: 'white',
		flex: 1
	},
  footerContainer: {
    marginTop: 5,
    marginLeft: 10,
    marginRight: 10,
    marginBottom: 10,
  },
  footerText: {
    fontSize: 14,
    color: '#aaa',
  },
  composer: {
    flex:1,
    flexDirection: 'row'
  },
  menuIcon: {
    width: 30,
    height: 30,
    opacity:0.8,
    paddingTop: 5,
    paddingLeft: 10,
  },
});

function select(store) {
  return {
    user: store.user,
  };
}

function actions(dispatch) {
  return {
    switchTab: () => dispatch(switchTab(1)), // to 'chats' tab
    loadMessages: (chat, date) => dispatch(loadMessages(chat, date)),
    setLatestMessage: (channelId, text) =>  dispatch(setLatestMessage(channelId, text)),
    createChat: (users) => dispatch(createChat(users)),
    leaveChat: (chatId) => dispatch(leaveChat(chatId))
  };
}

module.exports = connect(select, actions)(ChatView);
